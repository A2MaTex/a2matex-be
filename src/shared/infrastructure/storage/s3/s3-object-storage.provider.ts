import {
  AbortMultipartUploadCommand,
  CompletedPart,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import envConfig from '../../../config.ts';
import type {
  GetObjectOutput,
  ObjectStorageProvider,
  UploadObjectInput,
} from '../object-storage.interface.ts';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AbortMultipartUploadFailedException,
  GenerateDownloadUrlFailedException,
  InternalErrorException,
  MissingNextPartMarkerException,
  R2NotReturnUploadIdException,
} from '../../../errors/static.error.ts';
import {
  handleMultipartUploadError,
  handleR2HeadObjectError,
} from '../../../errors/static.error-handler.ts';
@Injectable()
export class S3ObjectStorageProvider implements ObjectStorageProvider {
  private readonly client: S3Client;

  constructor() {
    const credentials =
      envConfig.OBJECT_STORAGE_ACCESS_KEY_ID && envConfig.OBJECT_STORAGE_SECRET_ACCESS_KEY
        ? {
            accessKeyId: envConfig.OBJECT_STORAGE_ACCESS_KEY_ID,
            secretAccessKey: envConfig.OBJECT_STORAGE_SECRET_ACCESS_KEY,
          }
        : undefined;

    this.client = new S3Client({
      region: envConfig.OBJECT_STORAGE_REGION,
      endpoint: envConfig.OBJECT_STORAGE_ENDPOINT,
      credentials,
    });
  }

  async createMultipartUpload(key: string, contentType: string) {
    const response = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.getBucket(),
        Key: key,
        ContentType: contentType,
      }),
    );

    if (!response.UploadId) {
      Logger.error('R2 did not return an UploadId', response);

      throw R2NotReturnUploadIdException;
    }

    return response.UploadId;
  }

  // Tạo presigned URL cho một chunk
  async getUploadPartUrl(key: string, uploadId: string, partNumber: number) {
    const command = new UploadPartCommand({
      Bucket: this.getBucket(),
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: envConfig.MULTICHUNK_PART_UPLOAD_URL_TTL,
    });
  }

  // Lấy danh sách tất cả chunk đã upload
  async listParts(key: string, uploadId: string) {
    const parts = [];
    let marker: string | undefined;

    do {
      const result = await this.client.send(
        new ListPartsCommand({
          Bucket: this.getBucket(),
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );

      parts.push(...(result.Parts ?? []));

      if (!result.IsTruncated) break;

      marker = result.NextPartNumberMarker;
      if (!marker) {
        Logger.error('Missing next part marker', result);
        throw MissingNextPartMarkerException;
      }
    } while (true);

    return parts;
  }

  // Hoàn thành multipart upload
  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]) {
    try {
      return this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.getBucket(),
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0)),
          },
        }),
      );
    } catch (error) {
      if (error instanceof S3ServiceException) {
        handleMultipartUploadError(error);
      }

      Logger.error('Unexpected start multipart upload error', error);

      throw InternalErrorException;
    }
  }

  // Hủy multipart upload
  async abortMultipartUpload(key: string, uploadId: string) {
    try {
      return this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.getBucket(),
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (error) {
      if (error instanceof S3ServiceException) {
        handleMultipartUploadError(error);
      }

      Logger.error('Unexpected abort multipart upload error', error);

      throw AbortMultipartUploadFailedException;
    }
  }

  // Lấy metadata file
  async getMetadata(key: string) {
    try {
      return this.client.send(
        new HeadObjectCommand({
          Bucket: this.getBucket(),
          Key: key,
        }),
      );
    } catch (error) {
      handleR2HeadObjectError(error);
    }
  }

  async getDownloadUrl(key: string) {
    try {
      return getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.getBucket(),
          Key: key,
        }),
        { expiresIn: envConfig.FILE_DOWNLOAD_URL_TTL },
      );
    } catch (error) {
      Logger.error(
        'R2 GenerateDownloadUrl failed',
        error instanceof Error ? error.stack : String(error),
      );

      throw GenerateDownloadUrlFailedException;
    }
  }

  async uploadFile(input: UploadObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.getBucket(),
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.size,
      }),
    );
  }

  async getFile(objectKey: string): Promise<GetObjectOutput> {
    const output = await this.client.send(
      new GetObjectCommand({
        Bucket: this.getBucket(),
        Key: objectKey,
      }),
    );

    if (!(output.Body instanceof Readable)) {
      throw new Error('Object storage returned an unsupported response body');
    }

    return {
      body: output.Body,
      contentType: output.ContentType,
      size: output.ContentLength,
    };
  }

  async deleteFile(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.getBucket(),
        Key: objectKey,
      }),
    );
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.getBucket(),
          Key: key,
        }),
      );

      return true;
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        (error.name === 'NotFound' || error.name === 'NoSuchKey')
      ) {
        return false;
      }

      throw error;
    }
  }

  private getBucket(): string {
    if (!envConfig.OBJECT_STORAGE_BUCKET) {
      throw new Error('OBJECT_STORAGE_BUCKET is not configured');
    }
    return envConfig.OBJECT_STORAGE_BUCKET;
  }

  getMultipartSessionTTL(): number {
    if (!envConfig.MULTIPART_SESSION_TTL) {
      throw new Error('MULTIPART_SESSION_TTL is not configured');
    }
    return envConfig.MULTIPART_SESSION_TTL;
  }
}
