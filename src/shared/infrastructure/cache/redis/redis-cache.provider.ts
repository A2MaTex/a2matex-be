import { createClient, RedisClientType } from 'redis';
import { CacheKeyNotFoundError } from '../cache.error.ts';
import { CacheExpiration, CacheProvider } from '../cache.interface.ts';

export type RedisCacheProviderOptions = {
  host: string;
  port: number;
  keyPrefix?: string;
};

export class RedisCacheProvider implements CacheProvider {
  private readonly client: RedisClientType;
  private readonly keyPrefix: string;

  constructor(options: RedisCacheProviderOptions) {
    this.keyPrefix = options.keyPrefix ?? '';
    this.client = createClient({
      socket: {
        host: options.host,
        port: options.port,
      },
    });
  }

  async Connect() {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  async Disconnect() {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  async onModuleDestroy() {
    await this.Disconnect();
  }

  async SetState(prefixKey: string, key: string, value: string, expiration = 0) {
    const fullKey = this.buildKey(prefixKey, key);
    if (expiration > 0) {
      await this.client.set(fullKey, value, {
        expiration: {
          type: 'EX',
          value: expiration,
        },
      });
      return;
    }

    await this.client.set(fullKey, value);
  }

  async GetState(prefixKey: string, key: string) {
    const fullKey = this.buildKey(prefixKey, key);
    const value = await this.client.get(fullKey);
    if (value === null) {
      throw new CacheKeyNotFoundError(fullKey);
    }

    return value;
  }

  async RemoveState(prefixKey: string, key: string) {
    await this.client.del(this.buildKey(prefixKey, key));
  }

  SetStateObject<T>(prefixKey: string, key: string, value: T, expiration = 0) {
    return this.SetState(prefixKey, key, JSON.stringify(value), expiration);
  }

  async GetStateObject<T>(prefixKey: string, key: string): Promise<T> {
    const value = await this.GetState(prefixKey, key);

    try {
      return JSON.parse(value) as T;
    } catch {
      await this.RemoveState(prefixKey, key);
      throw new CacheKeyNotFoundError(this.buildKey(prefixKey, key));
    }
  }

  async GetStates(prefix: string, cursor = 0) {
    const result: Record<string, string> = {};
    const { keys } = await this.client.scan(cursor.toString(), {
      MATCH: this.buildKey(prefix, '*'),
      COUNT: 100,
    });

    for (const key of keys) {
      const value = await this.client.get(key);
      if (value !== null) {
        result[key] = value;
      }
    }

    return result;
  }

  async GetStatesWithPrefix(prefix: string) {
    const result: Record<string, unknown> = {};
    for await (const keys of this.client.scanIterator({
      MATCH: this.buildKey(prefix, '*'),
      COUNT: 100,
    })) {
      for (const key of keys) {
        const value = await this.client.get(key);
        if (value === null) {
          continue;
        }
        result[key] = JSON.parse(value) as unknown;
      }
    }

    return result;
  }

  async RemoveStates(prefixKey: string, keys: string[]) {
    if (keys.length === 0) {
      return;
    }

    await this.client.del(keys.map((key) => this.buildKey(prefixKey, key)));
  }

  async RemoveStatesWithPattern(prefix: string, pattern: string) {
    const keys = await this.GetKeys(`${prefix}${pattern}`);
    if (keys.length === 0) {
      return;
    }

    await this.client.del(keys);
  }

  async GetKeys(pattern: string) {
    const keys: string[] = [];
    for await (const batch of this.client.scanIterator({
      MATCH: this.buildKey('', pattern),
      COUNT: 100,
    })) {
      keys.push(...batch);
    }

    return keys;
  }

  async AddToSortedSet(key: string, score: number, member: unknown) {
    await this.client.zAdd(this.buildKey('', key), {
      score,
      value: JSON.stringify(member),
    });
  }

  GetFromSortedSetByScore(key: string, min: number, max: number) {
    return this.client.zRangeByScore(this.buildKey('', key), min, max);
  }

  async RemoveFromSortedSet(key: string, member: unknown) {
    await this.client.zRem(this.buildKey('', key), JSON.stringify(member));
  }

  async RemoveFromSortedSetByScore(key: string, min: number, max: number) {
    await this.client.zRemRangeByScore(this.buildKey('', key), min, max);
  }

  GetClient() {
    return this.client;
  }

  async DistributedLock(prefixKey: string, key: string, ttl: CacheExpiration) {
    const result = await this.client.set(this.buildKey(prefixKey, key), 'In used', {
      expiration: {
        type: 'EX',
        value: ttl,
      },
      condition: 'NX',
    });

    return result === 'OK';
  }

  private buildKey(prefixKey: string, key: string) {
    return `${this.keyPrefix}${prefixKey}${key}`;
  }
}
