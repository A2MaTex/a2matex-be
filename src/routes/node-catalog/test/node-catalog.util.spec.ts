import { canonicalJson, isRuntimeVersionCompatible, sha256Hex } from '../node-catalog.util.ts';

describe('Node Catalog utilities', () => {
  it('canonicalizes nested object keys before hashing', () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: 2 })).toBe(
      '{"a":2,"nested":{"a":1,"b":2},"z":1}',
    );
    expect(sha256Hex({ b: 2, a: 1 })).toBe(sha256Hex({ a: 1, b: 2 }));
  });

  it.each([
    ['0.1.0', '0.1.0', true],
    ['0.1.1', '0.1.0', true],
    ['0.2.0', '0.1.9', true],
    ['1.0.0', '0.9.9', true],
    ['0.0.9', '0.1.0', false],
    ['0.1.0', '0.1.1', false],
  ])('compares Runtime %s with minimum %s', (current, minimum, expected) => {
    expect(isRuntimeVersionCompatible(current, minimum)).toBe(expected);
  });
});
