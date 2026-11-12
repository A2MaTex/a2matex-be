import { ROLE_PERMISSION_CACHE_PREFIX } from '../shared/constants/cache.constant.ts';
import envConfig from '../shared/config.ts';
import { RedisCacheProvider } from '../shared/infrastructure/cache/redis/redis-cache.provider.ts';

/**
 * The access-token guard caches each role's permissions in Redis with no expiry,
 * so rows written straight to the database stay invisible until the cache is
 * dropped. Without this, every seed that adds a route answers 403 for everyone.
 */
export async function clearRolePermissionCache() {
  const cache = new RedisCacheProvider({
    host: envConfig.REDIS_HOST,
    port: envConfig.REDIS_PORT,
    password: envConfig.REDIS_PASSWORD,
    keyPrefix: `${envConfig.REDIS_PREFIX}${envConfig.NODE_ENV}:`,
  });

  try {
    await cache.Connect();
    await cache.RemoveStatesWithPattern(ROLE_PERMISSION_CACHE_PREFIX, '*');
    console.log('Cleared role permission cache');
  } catch (error) {
    // The database is already correct; a cache that cannot be reached is the
    // operator's problem to fix, but it must not fail the seed.
    console.error(
      `Could not clear the role permission cache, clear it manually: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    await cache.Disconnect().catch(() => undefined);
  }
}
