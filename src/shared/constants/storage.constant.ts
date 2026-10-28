export const DEFAULT_STATIC_PREFIX = 'index';
export const STATIC_OBJECT_KEY_CHUNK_LENGTH = 2;
export const STATIC_CONTENT_TYPE_MAX_LENGTH = 255;
export const STATIC_PREFIX_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const DEFAULT_STATIC_UPLOAD_MAX_SIZE_MB = 5;
export const STATIC_IMAGE_PREFIX = 'images';
export const STATIC_IMAGE_OUTPUT_CONTENT_TYPE = 'image/webp';
export const STATIC_IMAGE_MAX_INPUT_PIXELS = 40_000_000;
export const STATIC_IMAGE_MIN_QUALITY = 50;
export const STATIC_IMAGE_QUALITY_STEP = 5;
export const STATIC_IMAGE_MAX_ENCODE_ATTEMPTS = 6;
export const STATIC_IMAGE_RESIZE_SAFETY_FACTOR = 0.9;
export const STATIC_IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'image/svg',
  'image/svg+xml',
]);
export const STATIC_IMAGE_INPUT_FORMATS: ReadonlySet<string> = new Set([
  'gif',
  'jpeg',
  'png',
  'svg',
  'webp',
]);

export const STATIC_IMAGE_VARIANTS = ['small', 'medium', 'large'] as const;

export type StaticImageVariant = (typeof STATIC_IMAGE_VARIANTS)[number];
export type GeneratedStaticImageVariant = Exclude<StaticImageVariant, 'large'>;

export const STATIC_IMAGE_VARIANT_CONFIG: Record<
  StaticImageVariant,
  { maxDimension: number; quality: number; maxSizeBytes: number }
> = {
  small: {
    maxDimension: 128,
    quality: 75,
    maxSizeBytes: 50 * 1024,
  },
  medium: {
    maxDimension: 800,
    quality: 80,
    maxSizeBytes: 300 * 1024,
  },
  large: {
    maxDimension: 1920,
    quality: 85,
    maxSizeBytes: 1024 * 1024,
  },
};

export const MULTIPART_UPLOAD_CONTENT_FORMATS: ReadonlySet<string> = new Set([
  'application/x-msdownload',
]);
export const MULTIPART_UPLOAD_DEFAULT_PART_SIZE = 10 * 1024 * 1024;
