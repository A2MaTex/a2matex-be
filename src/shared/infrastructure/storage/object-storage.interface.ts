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
}
