// Revenue split between the Marketplace and the Publisher.
//
// Integer only. Floating point disagrees with integer arithmetic on real prices: at 29%
// it differs on 7030 of the first 2 million amounts (100 gives 28 instead of 29), and the
// database requires the two parts to add up to the total exactly.
export const COMMISSION_RATE_SCALE = 10000n;

export type AmountSplit = {
  commissionAmount: bigint;
  publisherAmount: bigint;
};

// The Publisher share is the remainder, never a second multiplication: subtraction is what
// makes the two parts sum to the total for every input, and it hands the odd unit left by
// the truncating division to the Publisher.
export const splitAmount = (totalAmount: bigint, rateBps: number): AmountSplit => {
  const commissionAmount = (totalAmount * BigInt(rateBps)) / COMMISSION_RATE_SCALE;
  return { commissionAmount, publisherAmount: totalAmount - commissionAmount };
};
