import { splitAmount } from '../order-split.ts';

// The invariant, not a handful of sample values. A test that only compares against known
// answers passes for a floating-point implementation that happens to be right on those
// inputs; this one fails on the first amount where float and integer disagree.
describe('splitAmount invariant', () => {
  const rates = [0, 1, 7, 250, 1275, 2900, 3000, 3333, 6667, 9999, 10000];
  const amounts = [
    0n, 1n, 2n, 3n, 7n, 99n, 100n, 101n, 999n, 1000n, 1001n, 2000n,
    99_000n, 100_000n, 100_005n, 123_456n, 999_999n, 1_000_000n,
    9_007_199_254_740_993n, // past Number.MAX_SAFE_INTEGER
  ];

  it('always sums back to the total', () => {
    for (const total of amounts) {
      for (const rateBps of rates) {
        const { commissionAmount, publisherAmount } = splitAmount(total, rateBps);
        expect(commissionAmount + publisherAmount).toBe(total);
      }
    }
  });

  it('never produces a negative part', () => {
    for (const total of amounts) {
      for (const rateBps of rates) {
        const { commissionAmount, publisherAmount } = splitAmount(total, rateBps);
        expect(commissionAmount >= 0n).toBe(true);
        expect(publisherAmount >= 0n).toBe(true);
      }
    }
  });

  // Truncating division means the leftover unit goes to the Publisher, never the platform.
  it('gives the remainder to the publisher', () => {
    for (const total of amounts) {
      for (const rateBps of rates) {
        const { commissionAmount } = splitAmount(total, rateBps);
        const exact = (total * BigInt(rateBps)) / 10000n;
        expect(commissionAmount).toBe(exact);
        expect(commissionAmount * 10000n <= total * BigInt(rateBps)).toBe(true);
      }
    }
  });
});

describe('splitAmount boundary values', () => {
  it.each([
    [100_000n, 3000, 30_000n, 70_000n],
    [100_005n, 3000, 30_001n, 70_004n],
    [100n, 2900, 29n, 71n], // float floor(100 * 0.29) gives 28
    [2_000n, 3000, 600n, 1_400n],
    [1n, 3000, 0n, 1n],
    [99_000n, 0, 0n, 99_000n],
    [99_000n, 10000, 99_000n, 0n],
    [0n, 3000, 0n, 0n],
  ])('%s at %i bps splits into %s / %s', (total, rateBps, commission, publisher) => {
    expect(splitAmount(total, rateBps)).toEqual({
      commissionAmount: commission,
      publisherAmount: publisher,
    });
  });

  // The case the whole integer rule exists for.
  it('disagrees with the floating-point result where float is wrong', () => {
    expect(splitAmount(100n, 2900).commissionAmount).toBe(29n);
    expect(Math.floor(100 * 0.29)).toBe(28);
  });

  it('gives the publisher everything at 0% and nothing at 100%', () => {
    expect(splitAmount(99_000n, 0)).toEqual({ commissionAmount: 0n, publisherAmount: 99_000n });
    expect(splitAmount(99_000n, 10000)).toEqual({ commissionAmount: 99_000n, publisherAmount: 0n });
  });
});
