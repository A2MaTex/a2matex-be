export class CacheKeyNotFoundError extends Error {
  constructor(key: string) {
    super(`Cache key not found: ${key}`);
    this.name = 'CacheKeyNotFoundError';
  }
}
