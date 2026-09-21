export type CacheExpiration = number;

export const CACHE_PROVIDER = Symbol('CACHE_PROVIDER');

export interface CacheProvider {
  Connect(): Promise<void>;
  Disconnect(): Promise<void>;

  SetState(
    prefixKey: string,
    key: string,
    value: string,
    expiration?: CacheExpiration,
  ): Promise<void>;

  GetState(prefixKey: string, key: string): Promise<string>;

  RemoveState(prefixKey: string, key: string): Promise<void>;

  SetStateObject<T>(
    prefixKey: string,
    key: string,
    value: T,
    expiration?: CacheExpiration,
  ): Promise<void>;

  GetStateObject<T>(prefixKey: string, key: string): Promise<T>;

  GetStates(prefix: string, cursor?: number): Promise<Record<string, string>>;

  GetStatesWithPrefix(prefix: string): Promise<Record<string, unknown>>;

  RemoveStates(prefixKey: string, keys: string[]): Promise<void>;

  RemoveStatesWithPattern(prefix: string, pattern: string): Promise<void>;

  GetKeys(pattern: string): Promise<string[]>;

  AddToSortedSet(key: string, score: number, member: unknown): Promise<void>;

  GetFromSortedSetByScore(key: string, min: number, max: number): Promise<string[]>;

  RemoveFromSortedSet(key: string, member: unknown): Promise<void>;

  RemoveFromSortedSetByScore(key: string, min: number, max: number): Promise<void>;

  GetClient(): unknown;

  DistributedLock(prefixKey: string, key: string, ttl: CacheExpiration): Promise<boolean>;
}
