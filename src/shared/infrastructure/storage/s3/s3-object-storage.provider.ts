import {
  AbortMultipartUploadCommand,
  CompletedPart,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import envConfig from '../../../config.ts';
import type {
  GetObjectOutput,
  ObjectStorageProvider,
  UploadObjectInput,
} from '../object-storage.interface.ts';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
      throw new Error('R2 did not return an UploadId');
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
      expiresIn: 900,
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
        throw new Error('Missing next part marker');
      }
    } while (true);

    return parts;
  }

  // Hoàn thành multipart upload
  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]) {
    return this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.getBucket(),
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts].sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0)),
        },
      }),
    );
  }

  // Hủy multipart upload
  async abortMultipartUpload(key: string, uploadId: string) {
    return this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.getBucket(),
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  // Lấy metadata file
  async getMetadata(key: string) {
    return this.client.send(
      new HeadObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
      }),
    );
  }

  async getDownloadUrl(key: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
      }),
      { expiresIn: 300 },
    );
  }

  async cleanupIncompleteUploads() {
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    let cleaned = 0;

    do {
      const result = await this.client.send(
        new ListMultipartUploadsCommand({
          Bucket: this.getBucket(),
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
        }),
      );

      for (const upload of result.Uploads ?? []) {
        if (!upload.Key || !upload.UploadId) continue;

        // Chỉ clean upload đã tồn tại quá 24 giờ
        if (!upload.Initiated || Date.now() - upload.Initiated.getTime() < 24 * 60 * 60 * 1000) {
          continue;
        }

        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.getBucket(),
            Key: upload.Key,
            UploadId: upload.UploadId,
          }),
        );

        cleaned++;
      }

      if (!result.IsTruncated) break;

      keyMarker = result.NextKeyMarker;
      uploadIdMarker = result.NextUploadIdMarker;
    } while (keyMarker);

    return { cleaned };
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

  private getBucket(): string {
    if (!envConfig.OBJECT_STORAGE_BUCKET) {
      throw new Error('OBJECT_STORAGE_BUCKET is not configured');
    }
    return envConfig.OBJECT_STORAGE_BUCKET;
  }
}
