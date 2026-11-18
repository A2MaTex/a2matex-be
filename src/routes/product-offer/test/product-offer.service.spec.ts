import { ConflictException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.ts';
import { TransactionService } from '../../../shared/services/transaction.service.ts';
import { ProductAccessPolicy } from '../../product/product-access.policy.ts';
import { ProductOfferRepo } from '../product-offer.repo.ts';
import { ProductOfferService } from '../product-offer.service.ts';

// The real module parses process.env and exits when a bound is missing, which CI has no
// .env for. The bounds under test are the two rate-limit ones.
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
vi.mock('../../../shared/services/transaction.service.ts', () => ({
  TransactionService: class TransactionService {},
}));
vi.mock('../../product/product-access.policy.ts', () => ({
  ProductAccessPolicy: class ProductAccessPolicy {},
}));
vi.mock('../product-offer.repo.ts', () => ({
  ProductOfferRepo: class ProductOfferRepo {},
}));

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PUBLISHER_ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-18T09:00:00.000Z');
const HOURS = 3_600_000;

const subscription = (durationDays: number, priceAmount: bigint) => ({
  type: 'SUBSCRIPTION' as const,
  priceAmount,
  durationDays,
});

const oneTime = (durationDays: number | null, priceAmount: bigint) => ({
  type: 'ONE_TIME' as const,
  priceAmount,
  durationDays,
});

describe('ProductOfferService', () => {
  const lockProduct = vi.fn();
  const lockOffers = vi.fn();
  const updatePrices = vi.fn();
  const insertOffers = vi.fn();
  const softDeleteOffers = vi.fn();
  const recordOfferChange = vi.fn();
  const resolveDraftSaveAccess = vi.fn();
  const runInTransaction = vi.fn((callback: () => unknown) => callback());
  let service: ProductOfferService;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveDraftSaveAccess.mockResolvedValue({ publisherAccountId: PUBLISHER_ACCOUNT_ID });
    lockProduct.mockResolvedValue({
      id: PRODUCT_ID,
      status: 'DRAFT',
      offerChangeTimestamps: [],
      transactionNow: NOW,
    });
    lockOffers.mockResolvedValue([]);
    service = new ProductOfferService(
      {
        lockProduct,
        lockOffers,
        updatePrices,
        insertOffers,
        softDeleteOffers,
        recordOfferChange,
      } as unknown as ProductOfferRepo,
      { resolveDraftSaveAccess } as unknown as ProductAccessPolicy,
      { runInTransaction } as unknown as TransactionService,
    );
  });

  const replace = (offers: ReturnType<typeof subscription>[] | ReturnType<typeof oneTime>[]) =>
    service.replace({
      productId: PRODUCT_ID,
      data: { offers },
      userId: USER_ID,
      scopes: ['OWN'],
    });

  it('inserts, reprices and soft-deletes in one pass keyed by type and duration', async () => {
    lockOffers.mockResolvedValue([
      { id: 'offer-30', type: 'SUBSCRIPTION', priceAmount: 100n, durationDays: 30 },
      { id: 'offer-90', type: 'SUBSCRIPTION', priceAmount: 250n, durationDays: 90 },
    ]);

    await replace([subscription(30, 120n), subscription(180, 450n)]);

    expect(updatePrices).toHaveBeenCalledWith({
      updates: [{ id: 'offer-30', priceAmount: 120n }],
      userId: USER_ID,
    });
    expect(insertOffers).toHaveBeenCalledWith({
      productId: PRODUCT_ID,
      offers: [subscription(180, 450n)],
      userId: USER_ID,
    });
    expect(softDeleteOffers).toHaveBeenCalledWith({
      offerIds: ['offer-90'],
      deletedAt: NOW,
      userId: USER_ID,
    });
  });

  it('treats an identical set as a no-op and writes nothing', async () => {
    lockOffers.mockResolvedValue([
      { id: 'offer-30', type: 'SUBSCRIPTION', priceAmount: 100n, durationDays: 30 },
    ]);

    await replace([subscription(30, 100n)]);

    expect(updatePrices).not.toHaveBeenCalled();
    expect(insertOffers).not.toHaveBeenCalled();
    expect(softDeleteOffers).not.toHaveBeenCalled();
    expect(recordOfferChange).not.toHaveBeenCalled();
  });

  it('separates a permanent ONE_TIME from a dated one', async () => {
    lockOffers.mockResolvedValue([
      { id: 'offer-permanent', type: 'ONE_TIME', priceAmount: 0n, durationDays: null },
    ]);

    await replace([oneTime(null, 0n), oneTime(7, 0n)]);

    expect(insertOffers).toHaveBeenCalledWith(
      expect.objectContaining({ offers: [oneTime(7, 0n)] }),
    );
    expect(softDeleteOffers).not.toHaveBeenCalled();
  });

  it('does not touch the sliding window while the Product is a draft', async () => {
    await replace([subscription(30, 100n)]);

    expect(insertOffers).toHaveBeenCalled();
    expect(recordOfferChange).not.toHaveBeenCalled();
  });

  it('drops timestamps older than the window and keeps the rest', async () => {
    lockProduct.mockResolvedValue({
      id: PRODUCT_ID,
      status: 'ACTIVE',
      offerChangeTimestamps: [
        new Date(NOW.getTime() - 48 * HOURS),
        new Date(NOW.getTime() - 2 * HOURS),
      ],
      transactionNow: NOW,
    });

    await replace([subscription(30, 100n)]);

    expect(recordOfferChange).toHaveBeenCalledWith({
      productId: PRODUCT_ID,
      timestamps: [new Date(NOW.getTime() - 2 * HOURS), NOW],
      userId: USER_ID,
    });
  });

  it('rejects a material change once the window is full', async () => {
    lockProduct.mockResolvedValue({
      id: PRODUCT_ID,
      status: 'ACTIVE',
      offerChangeTimestamps: [
        new Date(NOW.getTime() - 3 * HOURS),
        new Date(NOW.getTime() - 1 * HOURS),
      ],
      transactionNow: NOW,
    });

    const error = await replace([subscription(30, 100n)]).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    // The envelope has to match every other domain error: a bare string would answer
    // with a naked JSON string and leave the frontend without `message`.
    expect((error as HttpException).getResponse()).toEqual({
      message: 'Error.ProductOfferChangeRateLimitExceeded',
      error: 'Too Many Requests',
      statusCode: 429,
    });
    expect(insertOffers).not.toHaveBeenCalled();
    expect(recordOfferChange).not.toHaveBeenCalled();
  });

  it('refuses to leave an active Product without a subscription', async () => {
    lockProduct.mockResolvedValue({
      id: PRODUCT_ID,
      status: 'ACTIVE',
      offerChangeTimestamps: [],
      transactionNow: NOW,
    });
    lockOffers.mockResolvedValue([
      { id: 'offer-30', type: 'SUBSCRIPTION', priceAmount: 100n, durationDays: 30 },
    ]);

    await expect(replace([oneTime(7, 0n)])).rejects.toThrow(ConflictException);
    expect(lockOffers).not.toHaveBeenCalled();
    expect(softDeleteOffers).not.toHaveBeenCalled();
  });

  it.each(['SUSPENDED', 'ARCHIVED'])(
    'rejects replacement while the Product is %s',
    async (status) => {
      lockProduct.mockResolvedValue({
        id: PRODUCT_ID,
        status,
        offerChangeTimestamps: [],
        transactionNow: NOW,
      });

      await expect(replace([subscription(30, 100n)])).rejects.toThrow(ConflictException);
      expect(lockOffers).not.toHaveBeenCalled();
    },
  );

  // The loser of a race blocks on the Product row lock, so Prisma can time it out.
  it('answers 503 when the transaction times out on the lock', async () => {
    lockProduct.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('timed out', {
        code: 'P2028',
        clientVersion: 'test',
      }),
    );

    const error = await replace([subscription(30, 100n)]).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
  });

  it('runs inside one transaction', async () => {
    await replace([subscription(30, 100n)]);

    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(lockProduct).toHaveBeenCalledWith({
      productId: PRODUCT_ID,
      publisherAccountId: PUBLISHER_ACCOUNT_ID,
    });
  });
});
