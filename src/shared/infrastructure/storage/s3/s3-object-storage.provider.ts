import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import envConfig from '../../../config.ts';
import type {
  GetObjectOutput,
  ObjectStorageProvider,
  UploadObjectInput,
} from '../object-storage.interface.ts';

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
