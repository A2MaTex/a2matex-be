import { randomInt } from 'crypto';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  DEFAULT_STATIC_PREFIX,
  STATIC_OBJECT_KEY_CHUNK_LENGTH,
  STATIC_PREFIX_SEGMENT_PATTERN,
} from '../constants/storage.constant.ts';

export const generateOTP = () => {
  return String(randomInt(100000, 1000000));
};

export const generateRandomFilename = (filename: string) => {
  const ext = path.extname(filename);
  return `${uuidv4()}${ext}`;
};

export const buildStaticObjectKey = (staticId: string, prefix?: string) => {
  const compactId = staticId.replaceAll('-', '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(compactId)) {
    throw new Error('Static ID must be a valid UUID');
  }

  const normalizedPrefix = normalizeStaticPrefix(prefix);
  const chunks = compactId.match(new RegExp(`.{${STATIC_OBJECT_KEY_CHUNK_LENGTH}}`, 'g'));
  if (!chunks) {
    throw new Error('Unable to build the static object key');
  }

  return `${normalizedPrefix}/${chunks.join('/')}`;
};

export const isValidStaticPrefix = (prefix: string) => {
  try {
    normalizeStaticPrefix(prefix);
    return true;
  } catch {
    return false;
  }
};

const normalizeStaticPrefix = (prefix?: string) => {
  const trimmedPrefix = prefix?.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_STATIC_PREFIX;
  const segments = trimmedPrefix.split('/');

  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        !STATIC_PREFIX_SEGMENT_PATTERN.test(segment),
    )
  ) {
    throw new Error('Static prefix contains an invalid path segment');
  }

  return segments.join('/');
};

export const generateCancelPaymentJobId = (paymentId: number) => {
  return `paymentId-${paymentId}`;
};

export const generateRoomUserId = (userId: number) => {
  return `userId-${userId}`;
};
