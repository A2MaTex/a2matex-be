import { Prisma } from '../../../generated/prisma/client.ts';
import type { CacheProvider } from '../../../shared/infrastructure/cache/cache.interface.ts';
import type { TransactionService } from '../../../shared/services/transaction.service.ts';
import { EntitlementService } from '../../entitlement/entitlement.service.ts';
import { OrderRepo } from '../order.repo.ts';
import { OrderService } from '../order.service.ts';

vi.mock('../order.repo.ts', () => ({ OrderRepo: class OrderRepo {} }));
vi.mock('../../entitlement/entitlement.service.ts', () => ({
  EntitlementService: class EntitlementService {},
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PUBLISHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const OFFER_ID = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';

const offerRow = (overrides: Record<string, unknown> = {}) => ({
  id: OFFER_ID,
  productId: PRODUCT_ID,
  type: 'ONE_TIME',
  status: 'ACTIVE',
  priceMinor: 199_000n,
  currency: 'VND',
  durationDays: null,
  maxConcurrentDevices: 3,
  usagePolicy: { schemaVersion: '1.0' },
  productStatus: 'ACTIVE',
  publisherUserId: PUBLISHER_USER_ID,
  ...overrides,
});

describe('OrderService.create', () => {
  const getOffer = vi.fn();
  const debitBalance = vi.fn();
  const createPaidOrder = vi.fn();
  const createWalletPayment = vi.fn();
  const assertGrantable = vi.fn();
  const grantFromOrder = vi.fn();
  let service: OrderService;

  beforeEach(() => {
    [
      getOffer,
      debitBalance,
      createPaidOrder,
      createWalletPayment,
      assertGrantable,
      grantFromOrder,
    ].forEach((mock) => mock.mockReset());

    createPaidOrder.mockResolvedValue({
      id: 'order-1',
      OrderItem: [{ id: 'item-1', offerSnapshot: { schemaVersion: '1.0' } }],
    });
    createWalletPayment.mockResolvedValue({ id: 'payment-1' });
    grantFromOrder.mockResolvedValue({ id: 'entitlement-1' });
    debitBalance.mockResolvedValue({ count: 1 });

    service = new OrderService(
      {
        getOffer,
        debitBalance,
        createPaidOrder,
        createWalletPayment,
      } as unknown as OrderRepo,
      { assertGrantable, grantFromOrder } as unknown as EntitlementService,
      {
        runInTransaction: (callback: () => unknown) => callback(),
      } as unknown as TransactionService,
      {
        AcquireLock: () => Promise.resolve('owner'),
        ReleaseLock: () => Promise.resolve(true),
      } as unknown as CacheProvider,
    );
  });

  const create = (userId = USER_ID) => service.create({ offerId: OFFER_ID, userId });

  it('debits the wallet, records the payment and grants the Entitlement', async () => {
    getOffer.mockResolvedValue(offerRow());

    await expect(create()).resolves.toMatchObject({
      id: 'order-1',
      status: 'PAID',
      currency: 'VND',
      totalMinor: 199_000n,
      entitlementId: 'entitlement-1',
    });
    expect(debitBalance).toHaveBeenCalledWith({ userId: USER_ID, amount: 199_000n });
    expect(createWalletPayment).toHaveBeenCalledWith({
      orderId: 'order-1',
      amountMinor: 199_000n,
      currency: 'VND',
    });
  });

  // A zero-value Order still goes through the same path, it just never touches the wallet.
  it('skips the wallet for a FREE Offer and still names a currency', async () => {
    getOffer.mockResolvedValue(offerRow({ type: 'FREE', priceMinor: 0n, currency: null }));

    await expect(create()).resolves.toMatchObject({ totalMinor: 0n, currency: 'VND' });
    expect(debitBalance).not.toHaveBeenCalled();
    expect(grantFromOrder).toHaveBeenCalled();
  });

  it('refuses when the wallet cannot cover the Offer', async () => {
    getOffer.mockResolvedValue(offerRow());
    debitBalance.mockResolvedValue({ count: 0 });

    await expect(create()).rejects.toThrow('Error.InsufficientBalance');
    expect(createPaidOrder).not.toHaveBeenCalled();
  });

  it('answers not found for an Offer that does not exist', async () => {
    getOffer.mockResolvedValue(null);

    await expect(create()).rejects.toThrow('Error.ProductOfferNotFound');
  });

  it('refuses an Offer that is not on sale', async () => {
    getOffer.mockResolvedValue(offerRow({ status: 'DRAFT' }));

    await expect(create()).rejects.toThrow('Error.ProductOfferNotPurchasable');
  });

  it('refuses an Offer whose Product is not ACTIVE', async () => {
    getOffer.mockResolvedValue(offerRow({ productStatus: 'SUSPENDED' }));

    await expect(create()).rejects.toThrow('Error.ProductOfferNotPurchasable');
  });

  it('refuses a Publisher buying its own Product', async () => {
    getOffer.mockResolvedValue(offerRow());

    await expect(create(PUBLISHER_USER_ID)).rejects.toThrow('Error.CannotPurchaseOwnProduct');
  });

  it('stops before any write when the Entitlement rules refuse', async () => {
    getOffer.mockResolvedValue(offerRow());
    assertGrantable.mockRejectedValue(new Error('Error.ProductAlreadyOwned'));

    await expect(create()).rejects.toThrow('Error.ProductAlreadyOwned');
    expect(debitBalance).not.toHaveBeenCalled();
  });

  // Two checkouts racing past the guard: the ACTIVE Entitlement index settles it.
  it('turns the unique index conflict into already-owned', async () => {
    getOffer.mockResolvedValue(offerRow());
    grantFromOrder.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    await expect(create()).rejects.toThrow('Error.ProductAlreadyOwned');
  });
});
