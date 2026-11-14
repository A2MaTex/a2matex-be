import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';

export function toCanonicalBytes(value: unknown): Buffer {
  const json = canonicalize(value);

  if (typeof json !== 'string') {
    throw new Error('Invalid canonical JSON');
  }

  return Buffer.from(json, 'utf8');
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256')
    .update(buffer)
    .digest('hex');
}