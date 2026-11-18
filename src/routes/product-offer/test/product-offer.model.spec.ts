import { ReplaceProductOffersInput } from '../product-offer.model.ts';

vi.mock('../../../shared/config.ts', () => ({
  default: {
    API_PREFIX: 'api/v1',
    PRODUCT_OFFER_MAX_COUNT: 10,
    PRODUCT_OFFER_MAX_DURATION_DAYS: 3650,
    PRODUCT_OFFER_CHANGE_MAX_COUNT: 2,
    PRODUCT_OFFER_CHANGE_WINDOW_HOURS: 24,
    PRODUCT_OFFER_MAX_PRICE_AMOUNT: 9223372036854775807n,
  },
}));

const codes = (offers: unknown[]) => {
  const result = ReplaceProductOffersInput.safeParse({ offers });
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

const subscription = { type: 'SUBSCRIPTION', priceAmount: '100', durationDays: 30 };

describe('ReplaceProductOffersInput', () => {
  // The failure table names these codes; the frontend translates by key, so a zod
  // default message here is a broken contract rather than a cosmetic difference.
  it.each([
    ['decimal price', { type: 'ONE_TIME', priceAmount: '12.5', durationDays: null }],
    ['price above the BIGINT maximum', { type: 'ONE_TIME', priceAmount: '9999999999999999999', durationDays: null }],
    ['duration above the configured maximum', { type: 'ONE_TIME', priceAmount: '0', durationDays: 3651 }],
    ['zero duration', { type: 'ONE_TIME', priceAmount: '0', durationDays: 0 }],
    ['fractional duration', { type: 'ONE_TIME', priceAmount: '0', durationDays: 1.5 }],
    ['free subscription', { type: 'SUBSCRIPTION', priceAmount: '0', durationDays: 30 }],
    ['permanent subscription', { type: 'SUBSCRIPTION', priceAmount: '100', durationDays: null }],
  ])('answers Error.ProductOfferInvalid for %s', (_label, offer) => {
    expect(codes([offer])).toContain('Error.ProductOfferInvalid');
  });

  it('answers Error.ProductOfferLimitExceeded above the configured count', () => {
    const offers = Array.from({ length: 11 }, (_value, index) => ({
      ...subscription,
      durationDays: index + 1,
    }));

    expect(codes(offers)).toContain('Error.ProductOfferLimitExceeded');
  });

  it('answers Error.ProductOfferDuplicate for one natural key sent twice', () => {
    expect(codes([subscription, { ...subscription, priceAmount: '120' }])).toContain(
      'Error.ProductOfferDuplicate',
    );
  });

  it('canonicalises by type, finite duration, then permanent access', () => {
    const result = ReplaceProductOffersInput.parse({
      offers: [
        { type: 'SUBSCRIPTION', priceAmount: '250', durationDays: 90 },
        { type: 'ONE_TIME', priceAmount: '0', durationDays: null },
        subscription,
        { type: 'ONE_TIME', priceAmount: '5', durationDays: 7 },
      ],
    });

    expect(result.offers.map((offer) => `${offer.type}:${offer.durationDays}`)).toEqual([
      'ONE_TIME:7',
      'ONE_TIME:null',
      'SUBSCRIPTION:30',
      'SUBSCRIPTION:90',
    ]);
    expect(result.offers[0]?.priceAmount).toBe(5n);
  });
});
