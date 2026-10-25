import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Readable } from 'node:stream';
import sharp from 'sharp';
import { validate as isUuid } from 'uuid';
import type { StaticEntityType } from '../../entities/static.model.ts';
import {
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
  StaticImageVariantNotFoundException,
} from '../types/error.type.ts';
import { buildStaticObjectKey } from '../utils/utils.ts';
import { TransactionService } from './transaction.service.ts';

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
  /** The authenticated uploader; used to derive optional Publisher ownership. */
  userId: string;
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

    // Best effort on purpose: a Customer uploading an avatar has no Publisher
    // account and must still succeed, so a missing account means null ownership.
    const publisherAccountId = await this.staticRepository.findPublisherAccountIdByUserId(
      input.userId,
    );

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
            publisherAccountId,
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
}
