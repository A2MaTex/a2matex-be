// Fixed AES-256-GCM protocol sizes, shared by key operations and release validation.
export const AES_256_GCM_KEY_BYTES = 32;
export const AES_GCM_NONCE_BYTES = 12;
export const AES_GCM_AUTH_TAG_BYTES = 16;
export const WRAPPED_CONTENT_KEY_BYTES = AES_256_GCM_KEY_BYTES + AES_GCM_AUTH_TAG_BYTES;
export const AES_256_GCM_CIPHER = 'aes-256-gcm';
