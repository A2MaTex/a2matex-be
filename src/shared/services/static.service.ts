import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Readable } from 'node:stream';
import sharp from 'sharp';
import { validate as isUuid } from 'uuid';
import type { StaticEntityType } from '../../entities/static.model.ts';
import {
  ALLOW_FILE_UPLOAD_PREFIX,
  MULTIPART_UPLOAD_CONTENT_FORMATS,
  STATIC_CONTENT_TYPE_MAX_LENGTH,
  STATIC_IMAGE_CONTENT_TYPES,
  STATIC_IMAGE_INPUT_FORMATS,
  STATIC_IMAGE_MAX_ENCODE_ATTEMPTS,
  STATIC_IMAGE_MAX_INPUT_PIXELS,
  STATIC_IMAGE_MIN_QUALITY,
  STATIC_IMAGE_OUTPUT_CONTENT_TYPE,
  STATIC_IMAGE_PREFIX,
  STATIC_IMAGE_QUALITY_STEP,
  STATIC_IMAGE_RESIZE_SAFETY_FACTOR,
  STATIC_IMAGE_VARIANT_CONFIG,
  STATIC_IMAGE_VARIANTS,
  type GeneratedStaticImageVariant,
  type StaticImageVariant,
} from '../constants/storage.constant.ts';
import {
  OBJECT_STORAGE_PROVIDER,
  type ObjectStorageProvider,
} from '../infrastructure/storage/object-storage.interface.ts';
import {
  StaticRepository,
  type CreateStaticImageVariantInput,
} from '../repositories/static.repo.ts';
import {
  InvalidStaticImageTypeException,
  InvalidStaticMultipartUploadContentTypeException,
  StaticImageVariantNotFoundException,
} from '../types/error.type.ts';
import { buildStaticObjectKey } from '../utils/utils.ts';
import { TransactionService } from './transaction.service.ts';
import { UploadSessionRepository } from '../repositories/upload-session.repo.ts';
import {
  CompleteMultipartUploadInputDTO,
  CompleteMultipartUploadOutputDTO,
} from '../../../src/routes/static/static.dto.ts';
import envConfig from '../config.ts';
import { UploadSessionStatus } from '../constants/uploading-session.constant.ts';

export type UploadStaticFileInput = {
  body: Readable | Uint8Array;
  originalFileName: string;
  contentType: string;
  size: number;
  prefix?: string;
};

export type UploadStaticFileOutput = {
  id: string;
};

export type UploadStaticImageInput = {
  filePath: string;
  originalFileName: string;
  contentType: string;
  size: number;
};

export type UploadMultipartFileInput = {
  originalFileName: string;
  lastModified: number;
  contentType: string;
  size: number;
  prefix: string;
  userId: string;
  requestedPartNumbers: number[];
};

export type GetCompletedPartsInput = {
  originalFileName: string;
  lastModified: number;
  contentType: string;
  userId: string;
  size: number;
};

export type GetStaticFileOutput = {
  static: StaticEntityType;
  body: Readable;
};

export type GetStaticImageOutput = {
  body: Readable;
  contentType: string;
  size: number;
};

type GeneratedImage = {
  variant: StaticImageVariant;
  body: Uint8Array;
  width: number;
  height: number;
};

@Injectable()
export class StaticService {
  private readonly logger = new Logger(StaticService.name);

  constructor(
    @Inject(OBJECT_STORAGE_PROVIDER)
    private readonly storageProvider: ObjectStorageProvider,
    @Inject(StaticRepository)
    private readonly staticRepository: StaticRepository,
    @Inject(TransactionService)
    private readonly transactionService: TransactionService,
    @Inject(UploadSessionRepository)
    private readonly uploadSessionRepository: UploadSessionRepository,
  ) {}

  async uploadFile(input: UploadStaticFileInput): Promise<UploadStaticFileOutput> {
    this.validateUpload(input);

    const id = randomUUID();
    const objectKey = buildStaticObjectKey(id, input.prefix);
    const originalFileName = path.basename(input.originalFileName.trim());

    const createdStatic = await this.staticRepository.create({
      id,
      objectKey,
      originalFileName,
      contentType: input.contentType.trim(),
      size: BigInt(input.size),
    });

    try {
      await this.storageProvider.uploadFile({
        objectKey,
        contentType: input.contentType.trim(),
        body: input.body,
        size: input.size,
      });
    } catch (error) {
      await this.cleanupFailedUpload({ id, objectKey });
      throw error;
    }

    return createdStatic;
  }

  async uploadImage(input: UploadStaticImageInput): Promise<UploadStaticFileOutput> {
    const contentType = input.contentType.trim().toLowerCase();
    this.assertImageContentType(contentType);
    this.validateFileMetadata(input);
    await this.assertSupportedImage(input.filePath);

    const id = randomUUID();
    const objectKeyPrefix = buildStaticObjectKey(id, STATIC_IMAGE_PREFIX);
    const generatedImages: GeneratedImage[] = [];
    for (const variant of STATIC_IMAGE_VARIANTS) {
      generatedImages.push(await this.generateImage(input.filePath, variant));
    }
    const storedImages = generatedImages.map((image) => ({
      ...image,
      objectKey: `${objectKeyPrefix}/${image.variant}.webp`,
    }));

    const uploadResults = await Promise.allSettled(
      storedImages.map((image) => {
        return this.storageProvider.uploadFile({
          objectKey: image.objectKey,
          contentType: STATIC_IMAGE_OUTPUT_CONTENT_TYPE,
          body: image.body,
          size: image.body.byteLength,
        });
      }),
    );
    const failedUpload = uploadResults.find((result) => result.status === 'rejected');
    if (failedUpload?.status === 'rejected') {
      await this.cleanupImageObjects(storedImages.map(({ objectKey }) => objectKey));
      throw failedUpload.reason;
    }
    const largeImage = storedImages.find(({ variant }) => variant === 'large');
    if (!largeImage) {
      await this.cleanupImageObjects(storedImages.map(({ objectKey }) => objectKey));
      throw new Error('Large image variant was not generated');
    }

    try {
      return await this.transactionService.runInTransaction(() => {
        return this.staticRepository.createImage({
          staticRecord: {
            id,
            objectKey: largeImage.objectKey,
            originalFileName: path.basename(input.originalFileName.trim()),
            contentType: STATIC_IMAGE_OUTPUT_CONTENT_TYPE,
            size: BigInt(largeImage.body.byteLength),
          },
          variants: storedImages
            .filter(
              (image): image is typeof image & { variant: GeneratedStaticImageVariant } =>
                image.variant !== 'large',
            )
            .map((image): CreateStaticImageVariantInput => {
              return {
                id: randomUUID(),
                variant: image.variant.toUpperCase() as 'SMALL' | 'MEDIUM',
                objectKey: image.objectKey,
                contentType: STATIC_IMAGE_OUTPUT_CONTENT_TYPE,
                size: BigInt(image.body.byteLength),
                width: image.width,
                height: image.height,
              };
            }),
        });
      });
    } catch (error) {
      await this.cleanupImageObjects(storedImages.map(({ objectKey }) => objectKey));
      throw error;
    }
  }

  async startUploadMultipartFile(input: UploadMultipartFileInput) {
    try {
      const contentType = input.contentType.trim().toLowerCase();

      this.assertMultipartUploadContentType(contentType);
      this.validateMultipartUploadFileMetadata(input);
      this.checkValidPrefix(input.prefix);

      const id = randomUUID();
      const objectKeyPrefix = buildStaticObjectKey(id, input.prefix);

      const uploadId = await this.storageProvider.createMultipartUpload(
        objectKeyPrefix,
        contentType,
      );

      const fileHash = this.generateFileHash({
        userId: input.userId,
        fileName: input.originalFileName,
        fileSize: input.size,
        lastModified: input.lastModified,
      });

      let session = await this.uploadSessionRepository.getExistingByFileHash(fileHash);

      if (session?.status !== UploadSessionStatus.COMPLETED && session?.fileKey) {
        const matchStatic = await this.staticRepository.findByFileKey(session?.fileKey);

        if (matchStatic) {
          return {
            message: 'This file has been uploaded before.',
            staticId: matchStatic.id,
          };
        }
      }

      if (!session)
        session = await this.uploadSessionRepository.create({
          id: randomUUID(),
          createdBy: input.userId,
          expiresAt: new Date(Date.now() + envConfig.MULTIPART_SESSION_TTL),
          fileHash: fileHash,
          fileKey: objectKeyPrefix,
          uploadId,
          originalName: input.originalFileName,
          contentType: input.contentType,
          size: input.size,
        });

      const res = await this.getBatchUrls({
        sessionId: session.id,
        partNumbers: input.requestedPartNumbers,
      });

      return {
        sessionId: session.id,
        urls: res.uploadUrls,
      };
    } catch (error) {
      throw error;
    }
  }

  async getCompletedPart(input: GetCompletedPartsInput) {
    const fileHash = this.generateFileHash({
      userId: input.userId,
      fileName: input.originalFileName,
      fileSize: input.size,
      lastModified: input.lastModified,
    });
    const session = await this.uploadSessionRepository.getExistingByFileHash(fileHash);
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    return this.storageProvider.listParts(session.fileKey, session.uploadId);
  }

  async getBatchUrls({ sessionId, partNumbers }: { sessionId: string; partNumbers: number[] }) {
    const session = await this.uploadSessionRepository.getById(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const uploadUrls = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storageProvider.getUploadPartUrl(
          session.fileKey,
          session.uploadId,
          partNumber,
        ),
      })),
    );

    return { uploadUrls };
  }

  async completeMultipartUpload({
    sessionId,
    parts,
  }: CompleteMultipartUploadInputDTO): Promise<CompleteMultipartUploadOutputDTO> {
    const session = await this.uploadSessionRepository.getById(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    const listParts = await this.storageProvider.listParts(session.fileKey, session.uploadId);
    if (listParts.length !== parts.length) {
      await this.storageProvider.abortMultipartUpload(session.fileKey, session.uploadId);
      await this.uploadSessionRepository.abortSession(session.id);
      throw new Error('Invalid parts');
    }
    await this.storageProvider.completeMultipartUpload(
      session.fileKey,
      session.uploadId,
      listParts,
    );
    const staticFile = await this.staticRepository.create({
      id: randomUUID(),
      objectKey: session.fileKey,
      originalFileName: session.originalName,
      contentType: session.contentType,
      size: BigInt(session.size),
    });
    await this.uploadSessionRepository.endSession(session.id);
    return {
      staticId: staticFile.id,
      originalFileName: staticFile.originalFileName,
      size: Number(staticFile.size),
    };
  }

  async cleanExpiredUploadSessions() {
    const sessions = await this.uploadSessionRepository.getExpiredSessions();
    await Promise.all([
      this.storageProvider.cleanupIncompleteUploads(),
      sessions.map(async (session) => {
        await this.storageProvider.abortMultipartUpload(session.fileKey, session.uploadId);
        await this.uploadSessionRepository.softDeleteSession(session.id);
      }),
    ]);
  }

  async abortUploadSession(sessionId: string, userId: string) {
    const session = await this.uploadSessionRepository.getById(sessionId);
    if (session && session.status === UploadSessionStatus.UPLOADING) {
      this.storageProvider.abortMultipartUpload(session.fileKey, session.uploadId);
    }
    return {
      message: 'Abort successfully',
    };
  }

  async getFile(id: string): Promise<GetStaticFileOutput> {
    const staticRecord = await this.getStaticRecord(id);

    const storedFile = await this.storageProvider.getFile(staticRecord.objectKey);
    return {
      static: staticRecord,
      body: storedFile.body,
    };
  }

  async getImage(id: string, variant: StaticImageVariant = 'large'): Promise<GetStaticImageOutput> {
    const staticRecord = await this.getStaticRecord(id);
    this.assertImageContentType(staticRecord.contentType);

    const imageRecord =
      variant === 'large'
        ? {
            objectKey: staticRecord.objectKey,
            contentType: staticRecord.contentType,
            size: staticRecord.size,
          }
        : await this.staticRepository.findImageVariant(
            id,
            variant.toUpperCase() as 'SMALL' | 'MEDIUM',
          );
    if (!imageRecord) {
      throw StaticImageVariantNotFoundException;
    }

    const storedFile = await this.storageProvider.getFile(imageRecord.objectKey);
    return {
      body: storedFile.body,
      contentType: imageRecord.contentType,
      size: Number(imageRecord.size),
    };
  }

  private validateUpload(input: UploadStaticFileInput): void {
    this.validateFileMetadata(input);
  }

  private validateFileMetadata(input: {
    originalFileName: string;
    contentType: string;
    size: number;
  }): void {
    const originalFileName = path.basename(input.originalFileName.trim());
    if (originalFileName.length === 0 || originalFileName === '.' || originalFileName === '..') {
      throw new Error('Original file name is required');
    }
    const contentType = input.contentType.trim();
    if (contentType.length === 0 || contentType.length > STATIC_CONTENT_TYPE_MAX_LENGTH) {
      throw new Error('Content type is required');
    }
    if (!Number.isSafeInteger(input.size) || input.size < 0) {
      throw new Error('File size must be a non-negative safe integer');
    }
  }

  private validateMultipartUploadFileMetadata(input: {
    originalFileName: string;
    contentType: string;
    size: number;
  }): void {
    const originalFileName = path.basename(input.originalFileName.trim());
    if (originalFileName.length === 0 || originalFileName === '.' || originalFileName === '..') {
      throw new Error('Original file name is required');
    }
    const contentType = input.contentType.trim();
    if (contentType.length === 0 || contentType.length > STATIC_CONTENT_TYPE_MAX_LENGTH) {
      throw new Error('Content type is required');
    }
    if (!Number.isSafeInteger(input.size) || input.size < 0) {
      throw new Error('File size must be a non-negative safe integer');
    }
  }

  private async getStaticRecord(id: string): Promise<StaticEntityType> {
    if (!isUuid(id)) {
      throw new NotFoundException('Error.StaticNotFound');
    }

    const staticRecord = await this.staticRepository.findById(id);
    if (!staticRecord) {
      throw new NotFoundException('Error.StaticNotFound');
    }
    return staticRecord;
  }

  private assertImageContentType(contentType: string): void {
    if (!STATIC_IMAGE_CONTENT_TYPES.has(contentType.trim().toLowerCase())) {
      throw InvalidStaticImageTypeException;
    }
  }

  private assertMultipartUploadContentType(contentType: string): void {
    if (!MULTIPART_UPLOAD_CONTENT_FORMATS.has(contentType.trim().toLowerCase())) {
      throw InvalidStaticMultipartUploadContentTypeException;
    }
  }

  private async assertSupportedImage(filePath: string): Promise<void> {
    try {
      const metadata = await sharp(filePath, {
        limitInputPixels: STATIC_IMAGE_MAX_INPUT_PIXELS,
      }).metadata();
      if (!metadata.format || !STATIC_IMAGE_INPUT_FORMATS.has(metadata.format)) {
        throw InvalidStaticImageTypeException;
      }
    } catch (error) {
      if (error === InvalidStaticImageTypeException) {
        throw error;
      }
      throw InvalidStaticImageTypeException;
    }
  }

  private async generateImage(
    filePath: string,
    variant: StaticImageVariant,
  ): Promise<GeneratedImage> {
    const config = STATIC_IMAGE_VARIANT_CONFIG[variant];
    let maxDimension = config.maxDimension;
    let quality = config.quality;

    for (let attempt = 0; attempt < STATIC_IMAGE_MAX_ENCODE_ATTEMPTS; attempt += 1) {
      const { data, info } = await sharp(filePath, {
        animated: false,
        limitInputPixels: STATIC_IMAGE_MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize({
          width: maxDimension,
          height: maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });

      if (data.byteLength <= config.maxSizeBytes) {
        return {
          variant,
          body: data,
          width: info.width,
          height: info.height,
        };
      }

      const currentMaxDimension = Math.max(info.width, info.height);
      const sizeRatio = Math.sqrt(config.maxSizeBytes / data.byteLength);
      maxDimension = Math.max(
        1,
        Math.floor(currentMaxDimension * sizeRatio * STATIC_IMAGE_RESIZE_SAFETY_FACTOR),
      );
      quality = Math.max(STATIC_IMAGE_MIN_QUALITY, quality - STATIC_IMAGE_QUALITY_STEP);
    }

    throw new PayloadTooLargeException('Error.ImageVariantTooLarge');
  }

  private async cleanupImageObjects(objectKeys: string[]): Promise<void> {
    const cleanupResults = await Promise.allSettled(
      objectKeys.map((objectKey) => this.storageProvider.deleteFile(objectKey)),
    );

    cleanupResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Failed to clean up image object ${objectKeys[index]}`,
          result.reason instanceof Error ? result.reason.stack : undefined,
        );
      }
    });
  }

  private async cleanupFailedUpload({ id, objectKey }: { id: string; objectKey: string }) {
    const [storageCleanup, metadataCleanup] = await Promise.allSettled([
      this.storageProvider.deleteFile(objectKey),
      this.staticRepository.hardDelete(id),
    ]);

    if (storageCleanup.status === 'rejected') {
      this.logger.error(
        `Failed to clean up object ${objectKey} after upload failure`,
        storageCleanup.reason instanceof Error ? storageCleanup.reason.stack : undefined,
      );
    }
    if (metadataCleanup.status === 'rejected') {
      this.logger.error(
        `Failed to clean up static metadata ${id} after upload failure`,
        metadataCleanup.reason instanceof Error ? metadataCleanup.reason.stack : undefined,
      );
    }
  }
  private generateFileHash({
    userId,
    fileName,
    fileSize,
    lastModified,
  }: {
    userId: string;
    fileName: string;
    fileSize: number;
    lastModified: number;
  }): string {
    const metadata = `${userId}:${fileName}:${fileSize}:${lastModified}`;

    return createHash('md5').update(metadata).digest('hex');
  }

  private checkValidPrefix(prefix: string): void {
    if (!ALLOW_FILE_UPLOAD_PREFIX.some((e) => e === prefix)) {
      throw new Error('Prefix is not allowed');
    }
  }
}
