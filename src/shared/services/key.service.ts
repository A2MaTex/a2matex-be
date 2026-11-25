import { Injectable, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import envConfig from '../config.ts';
import {
  AES_256_GCM_CIPHER,
  AES_256_GCM_KEY_BYTES,
  AES_GCM_AUTH_TAG_BYTES,
  AES_GCM_NONCE_BYTES,
  WRAPPED_CONTENT_KEY_BYTES,
} from '../constants/key.constant.ts';

export interface EncryptedWorkflow {
  ciphertext: Buffer;
  nonce: Buffer;
}

@Injectable()
export class KeyService implements OnModuleInit {
  // Key of content key
  private kek!: Buffer;

  onModuleInit(): void {
    const encodedKey = envConfig.MASTER_KEY;

    if (!encodedKey) {
      throw new Error('MASTER_KEY is not configured');
    }

    const key = Buffer.from(encodedKey, 'base64');

    if (key.length !== AES_256_GCM_KEY_BYTES || key.toString('base64') !== encodedKey) {
      throw new Error(`MASTER_KEY must be a ${AES_256_GCM_KEY_BYTES}-byte Base64 key`);
    }

    this.kek = key;
  }

  generate(releaseId: string): {
    wrappedKey: Buffer;
    keyNonce: Buffer;
  } {
    this.assertReleaseId(releaseId);
    // generate random contentKey
    const contentKey = randomBytes(AES_256_GCM_KEY_BYTES);

    try {
      const { wrappedKey, nonce } = this.wrapContentKey(contentKey, releaseId);

      return {
        wrappedKey,
        keyNonce: nonce,
      };
    } finally {
      contentKey.fill(0);
    }
  }

  async withKey<T>(
    releaseId: string,
    wrappedKey: Buffer,
    keyNonce: Buffer,
    operation: (contentKey: Buffer) => Promise<T>,
  ): Promise<T> {
    this.assertReleaseId(releaseId);
    let contentKey: Buffer | undefined;
    try {
      // 1. Unwrap content key
      contentKey = this.unwrapContentKey(wrappedKey, keyNonce, releaseId);

      this.assertContentKey(contentKey);

      // 2. Cho phép callback sử dụng DEK
      return await operation(contentKey);
    } finally {
      // 3. Xóa nội dung DEK khỏi Buffer
      contentKey?.fill(0);
    }
  }

  // Encode content key with release id
  private wrapContentKey(
    contentKey: Buffer,
    releaseId: string,
  ): { wrappedKey: Buffer; nonce: Buffer } {
    this.assertContentKey(contentKey);

    const nonce = randomBytes(AES_GCM_NONCE_BYTES);

    const cipher = createCipheriv(AES_256_GCM_CIPHER, this.kek, nonce, {
      authTagLength: AES_GCM_AUTH_TAG_BYTES,
    });

    cipher.setAAD(Buffer.from(`release:${releaseId}`, 'utf8'));

    const ciphertext = Buffer.concat([cipher.update(contentKey), cipher.final()]);

    const wrappedKey = Buffer.concat([ciphertext, cipher.getAuthTag()]);

    return { wrappedKey, nonce };
  }

  private unwrapContentKey(wrappedKey: Buffer, nonce: Buffer, releaseId: string): Buffer {
    if (wrappedKey.length !== WRAPPED_CONTENT_KEY_BYTES) {
      throw new Error('Invalid wrapped key length');
    }

    if (nonce.length !== AES_GCM_NONCE_BYTES) {
      throw new Error('Invalid nonce length');
    }

    try {
      const tagStart = wrappedKey.length - AES_GCM_AUTH_TAG_BYTES;

      const ciphertext = wrappedKey.subarray(0, tagStart);
      const authTag = wrappedKey.subarray(tagStart);

      const decipher = createDecipheriv(AES_256_GCM_CIPHER, this.kek, nonce, {
        authTagLength: AES_GCM_AUTH_TAG_BYTES,
      });

      decipher.setAAD(Buffer.from(`release:${releaseId}`, 'utf8'));
      decipher.setAuthTag(authTag);

      const contentKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      this.assertContentKey(contentKey);

      return contentKey;
    } catch {
      throw new Error('Unable to unwrap ContentKey');
    }
  }

  encrypt(plaintext: Buffer, contentKey: Buffer): EncryptedWorkflow {
    this.assertContentKey(contentKey);

    const nonce = randomBytes(AES_GCM_NONCE_BYTES);

    const cipher = createCipheriv(AES_256_GCM_CIPHER, contentKey, nonce, {
      authTagLength: AES_GCM_AUTH_TAG_BYTES,
    });

    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    const authTag = cipher.getAuthTag();

    return {
      ciphertext: Buffer.concat([encrypted, authTag]),
      nonce,
    };
  }

  decrypt(encrypted: EncryptedWorkflow, contentKey: Buffer): Buffer {
    this.assertContentKey(contentKey);

    const { ciphertext, nonce } = encrypted;

    if (nonce.length !== AES_GCM_NONCE_BYTES) {
      throw new Error('Invalid GCM nonce');
    }

    if (ciphertext.length < AES_GCM_AUTH_TAG_BYTES) {
      throw new Error('Invalid encrypted workflow');
    }

    const tagStart = ciphertext.length - AES_GCM_AUTH_TAG_BYTES;

    const encryptedData = ciphertext.subarray(0, tagStart);
    const authTag = ciphertext.subarray(tagStart);

    const decipher = createDecipheriv(AES_256_GCM_CIPHER, contentKey, nonce, {
      authTagLength: AES_GCM_AUTH_TAG_BYTES,
    });

    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  }

  private assertContentKey(contentKey: Buffer): void {
    if (!Buffer.isBuffer(contentKey) || contentKey.length !== AES_256_GCM_KEY_BYTES) {
      throw new Error(`ContentKey must be exactly ${AES_256_GCM_KEY_BYTES} bytes`);
    }
  }

  private assertReleaseId(releaseId: string): void {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    if (!UUID_REGEX.test(releaseId)) {
      throw new Error('Invalid release ID');
    }
  }
}
