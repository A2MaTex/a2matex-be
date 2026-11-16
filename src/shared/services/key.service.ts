import { Injectable, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import envConfig from '../config.ts';

export interface EncryptedWorkflow {
  ciphertext: Buffer;
  nonce: Buffer;
}

@Injectable()
export class KeyService implements OnModuleInit {
  private readonly CONTENT_KEY_LENGTH = 32;
  private readonly NONCE_LENGTH = 12;
  private readonly AUTH_TAG_LENGTH = 16;

  private readonly GCM_ALGORITHM = 'aes-256-gcm';

  // Key of content key
  private kek!: Buffer;

  onModuleInit(): void {
    const encodedKey = envConfig.MASTER_KEY;

    if (!encodedKey) {
      throw new Error('MASTER_KEY is not configured');
    }

    const key = Buffer.from(encodedKey, 'base64');

    if (key.length !== 32 || key.toString('base64') !== encodedKey) {
      throw new Error('MASTER_KEY must be a 32-byte Base64 key');
    }

    this.kek = key;
  }

  generate(releaseId: string): {
    wrappedKey: Buffer;
    keyNonce: Buffer;
  } {
    this.assertReleaseId(releaseId);
    // generate random contentKey
    const contentKey = randomBytes(this.CONTENT_KEY_LENGTH);

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

    const nonce = randomBytes(this.NONCE_LENGTH);

    const cipher = createCipheriv(this.GCM_ALGORITHM, this.kek, nonce, {
      authTagLength: this.AUTH_TAG_LENGTH,
    });

    cipher.setAAD(Buffer.from(`release:${releaseId}`, 'utf8'));

    const ciphertext = Buffer.concat([cipher.update(contentKey), cipher.final()]);

    const wrappedKey = Buffer.concat([ciphertext, cipher.getAuthTag()]);

    return { wrappedKey, nonce };
  }

  private unwrapContentKey(wrappedKey: Buffer, nonce: Buffer, releaseId: string): Buffer {
    if (wrappedKey.length !== this.CONTENT_KEY_LENGTH + this.AUTH_TAG_LENGTH) {
      throw new Error('Invalid wrapped key length');
    }

    if (nonce.length !== this.NONCE_LENGTH) {
      throw new Error('Invalid nonce length');
    }

    try {
      const tagStart = wrappedKey.length - this.AUTH_TAG_LENGTH;

      const ciphertext = wrappedKey.subarray(0, tagStart);
      const authTag = wrappedKey.subarray(tagStart);

      const decipher = createDecipheriv(this.GCM_ALGORITHM, this.kek, nonce, {
        authTagLength: this.AUTH_TAG_LENGTH,
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

    const nonce = randomBytes(this.NONCE_LENGTH);

    const cipher = createCipheriv(this.GCM_ALGORITHM, contentKey, nonce, {
      authTagLength: this.AUTH_TAG_LENGTH,
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

    if (nonce.length !== this.NONCE_LENGTH) {
      throw new Error('Invalid GCM nonce');
    }

    if (ciphertext.length < this.AUTH_TAG_LENGTH) {
      throw new Error('Invalid encrypted workflow');
    }

    const tagStart = ciphertext.length - this.AUTH_TAG_LENGTH;

    const encryptedData = ciphertext.subarray(0, tagStart);
    const authTag = ciphertext.subarray(tagStart);

    const decipher = createDecipheriv(this.GCM_ALGORITHM, contentKey, nonce, {
      authTagLength: this.AUTH_TAG_LENGTH,
    });

    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  }

  private assertContentKey(contentKey: Buffer): void {
    if (!Buffer.isBuffer(contentKey) || contentKey.length !== this.CONTENT_KEY_LENGTH) {
      throw new Error('ContentKey must be exactly 32 bytes');
    }
  }

  private assertReleaseId(releaseId: string): void {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    if (!UUID_REGEX.test(releaseId)) {
      throw new Error('Invalid release ID');
    }
  }
}
