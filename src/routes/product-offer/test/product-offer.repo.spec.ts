import { PrismaService } from '../../../shared/services/prisma.service.ts';
import { ProductOfferRepo } from '../product-offer.repo.ts';

vi.mock('../../../shared/services/prisma.service.ts', () => ({
  PrismaService: class PrismaService {},
}));

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PUBLISHER_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

describe('ProductOfferRepo', () => {
  const $queryRaw = vi.fn();
  const findUniqueOrThrow = vi.fn();
  let repo: ProductOfferRepo;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ProductOfferRepo({
      getClient: () => ({ $queryRaw, product: { findUniqueOrThrow } }),
    } as unknown as PrismaService);
  });

  // The driver may hand back BIGINT and INTEGER as strings. Left as they arrive, every
  // diff would look like a price change and spend a rate-limit slot on a no-op request.
  it('normalises offer rows whichever shape the driver returns', async () => {
    $queryRaw.mockResolvedValue([
      { id: 'offer-a', type: 'SUBSCRIPTION', priceAmount: '100', durationDays: '30' },
      { id: 'offer-b', type: 'ONE_TIME', priceAmount: 0n, durationDays: null },
    ]);

    await expect(repo.lockOffers(PRODUCT_ID)).resolves.toEqual([
      { id: 'offer-a', type: 'SUBSCRIPTION', priceAmount: 100n, durationDays: 30 },
      { id: 'offer-b', type: 'ONE_TIME', priceAmount: 0n, durationDays: null },
    ]);
  });

  it.each([
    ['string', '1763456400000'],
    ['bigint', 1763456400000n],
    ['number', 1763456400000],
  ])('reads the transaction clock returned as a %s', async (_label, transactionNowMs) => {
    $queryRaw.mockResolvedValue([{ id: PRODUCT_ID, status: 'ACTIVE', transactionNowMs }]);
    const stored = [new Date('2026-11-18T08:00:00.000Z')];
    findUniqueOrThrow.mockResolvedValue({ offerChangeTimestamps: stored });

    await expect(
      repo.lockProduct({ productId: PRODUCT_ID, publisherAccountId: PUBLISHER_ACCOUNT_ID }),
    ).resolves.toEqual({
      id: PRODUCT_ID,
      status: 'ACTIVE',
      offerChangeTimestamps: stored,
      transactionNow: new Date(1763456400000),
    });
  });

  it('returns null and reads nothing further when the Product is not the caller’s', async () => {
    $queryRaw.mockResolvedValue([]);

    await expect(
      repo.lockProduct({ productId: PRODUCT_ID, publisherAccountId: PUBLISHER_ACCOUNT_ID }),
    ).resolves.toBeNull();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
