import { createHash } from 'node:crypto';

function normalizeForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForCanonicalJson);
  }

  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = normalizeForCanonicalJson((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }

  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(normalizeForCanonicalJson(value));
}

export function sha256Hex(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function isRuntimeVersionCompatible(currentVersion: string, minimumVersion: string) {
  const current = currentVersion.split('.').map(Number);
  const minimum = minimumVersion.split('.').map(Number);

  for (let index = 0; index < 3; index += 1) {
    if (current[index] > minimum[index]) {
      return true;
    }
    if (current[index] < minimum[index]) {
      return false;
    }
  }

  return true;
}
