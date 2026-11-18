export const ProductOfferType = {
  ONE_TIME: 'ONE_TIME',
  SUBSCRIPTION: 'SUBSCRIPTION',
} as const;

export type ProductOfferTypeValue = (typeof ProductOfferType)[keyof typeof ProductOfferType];
