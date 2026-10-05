import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { validate as isUuid } from 'uuid';
import type { StaticEntityType } from '../../entities/static.model.ts';
import { STATIC_CONTENT_TYPE_MAX_LENGTH } from '../constants/storage.constant.ts';
import {
  OBJECT_STORAGE_PROVIDER,
  type ObjectStorageProvider,
} from '../infrastructure/storage/object-storage.interface.ts';
import { StaticRepository } from '../repositories/static.repo.ts';
import { buildStaticObjectKey } from '../utils/utils.ts';

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

export type GetStaticFileOutput = {
  static: StaticEntityType;
  body: Readable;
};

@Injectable()
export class StaticService {
  private readonly logger = new Logger(StaticService.name);

  constructor(
    @Inject(OBJECT_STORAGE_PROVIDER)
    private readonly storageProvider: ObjectStorageProvider,
    @Inject(StaticRepository)
    private readonly staticRepository: StaticRepository,
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

  async getFile(id: string): Promise<GetStaticFileOutput> {
    if (!isUuid(id)) {
      throw new NotFoundException('Error.StaticNotFound');
    }

    const staticRecord = await this.staticRepository.findById(id);
    if (!staticRecord) {
      throw new NotFoundException('Error.StaticNotFound');
    }

    const storedFile = await this.storageProvider.getFile(staticRecord.objectKey);
    return {
      static: staticRecord,
      body: storedFile.body,
    };
  }

  private validateUpload(input: UploadStaticFileInput): void {
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
