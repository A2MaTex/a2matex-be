import { ConflictException, Logger } from '@nestjs/common';
import {
  DISTRIBUTED_LOCK_CACHE_PREFIX,
  DISTRIBUTED_LOCK_CONFLICT_MESSAGE,
  DISTRIBUTED_LOCK_DEFAULT_TTL_SECONDS,
} from '../constants/cache.constant.ts';
import { CacheExpiration, CacheProvider } from '../infrastructure/cache/cache.interface.ts';

type LockResourceValue = string | number | boolean | bigint;
type LockResourceFactory<Args extends unknown[]> = (...args: Args) => LockResourceValue;

export type DistributedLockOptions<Args extends unknown[] = unknown[]> = {
  useCase: string;
  resource?: LockResourceValue | LockResourceFactory<Args>;
  ttl?: CacheExpiration;
};

type DistributedLockInstance = {
  cacheProvider?: Pick<CacheProvider, 'AcquireLock' | 'ReleaseLock'>;
  constructor: {
    name: string;
  };
};

type DistributedLockMethod = (...args: any[]) => unknown;

const logger = new Logger('DistributedLock');

export function DistributedLock<Args extends unknown[] = unknown[]>(
  options: DistributedLockOptions<Args>,
): MethodDecorator {
  validateDistributedLockOptions(options);

  return function (
    _target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): void {
    const originalMethod = descriptor.value as DistributedLockMethod | undefined;
    if (!originalMethod) {
      return;
    }

    descriptor.value = async function (this: DistributedLockInstance, ...args: Args) {
      if (!this.cacheProvider) {
        throw new Error(
          `@DistributedLock requires ${String(propertyKey)} to be declared on a class that injects CacheProvider as cacheProvider`,
        );
      }

      const key = buildDistributedLockKey(options, args);
      const owner = await this.cacheProvider.AcquireLock(
        DISTRIBUTED_LOCK_CACHE_PREFIX,
        key,
        options.ttl ?? DISTRIBUTED_LOCK_DEFAULT_TTL_SECONDS,
      );

      if (owner === null) {
        throw new ConflictException(DISTRIBUTED_LOCK_CONFLICT_MESSAGE);
      }

      try {
        return await originalMethod.apply(this, args);
      } finally {
        await releaseLock({
          cacheProvider: this.cacheProvider,
          key,
          owner,
          source: `${this.constructor.name}.${String(propertyKey)}`,
        });
      }
    };
  };
}

function validateDistributedLockOptions<Args extends unknown[]>(
  options: DistributedLockOptions<Args>,
): void {
  if (options.useCase.trim().length === 0) {
    throw new Error('@DistributedLock requires a non-empty useCase');
  }
}

function buildDistributedLockKey<Args extends unknown[]>(
  options: DistributedLockOptions<Args>,
  args: Args,
): string {
  if (options.resource !== undefined) {
    return `${options.useCase}_${String(resolveLockResource(options.resource, args))}`;
  }

  return options.useCase;
}

function resolveLockResource<Args extends unknown[]>(
  resource: LockResourceValue | LockResourceFactory<Args>,
  args: Args,
): LockResourceValue {
  if (typeof resource === 'function') {
    return resource(...args);
  }

  return resource;
}

async function releaseLock({
  cacheProvider,
  key,
  owner,
  source,
}: {
  cacheProvider: Pick<CacheProvider, 'ReleaseLock'>;
  key: string;
  owner: string;
  source: string;
}) {
  try {
    const released = await cacheProvider.ReleaseLock(DISTRIBUTED_LOCK_CACHE_PREFIX, key, owner);
    if (!released) {
      logger.warn(`Lock was not released because ownership changed: ${source}`);
    }
  } catch (error) {
    logger.error(
      `Failed to release distributed lock after ${source}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
