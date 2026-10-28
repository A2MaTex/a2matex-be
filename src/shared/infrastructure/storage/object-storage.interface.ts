import {
  AbortMultipartUploadCommandOutput,
  CompletedPart,
  CompleteMultipartUploadCommandOutput,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

export const OBJECT_STORAGE_PROVIDER = Symbol('OBJECT_STORAGE_PROVIDER');

export type UploadObjectInput = {
  objectKey: string;
  body: Readable | Uint8Array;
  contentType: string;
  size: number;
};

export type GetObjectOutput = {
  body: Readable;
  contentType?: string;
  size?: number;
};

export interface ObjectStorageProvider {
  uploadFile(input: UploadObjectInput): Promise<void>;
  getFile(objectKey: string): Promise<GetObjectOutput>;
  deleteFile(objectKey: string): Promise<void>;
  createMultipartUpload(objectKey: string, contentType: string): Promise<string>;
  getUploadPartUrl(objectKey: string, uploadId: string, partNumber: number): Promise<string>;
  listParts(objectKey: string, uploadId: string): Promise<any[]>;
  completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<CompleteMultipartUploadCommandOutput>;
  abortMultipartUpload(
    objectKey: string,
    uploadId: string,
  ): Promise<AbortMultipartUploadCommandOutput>;
  getMetadata(objectKey: string): Promise<any>;
  cleanupIncompleteUploads(): Promise<{ cleaned: number }>;
}
