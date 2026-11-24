import { Prisma } from '../../../generated/prisma/client.ts';
import { OrderService } from '../order.service.ts';
import type { OrderRepo } from '../order.repo.ts';
import type { EntitlementService } from '../../entitlement/entitlement.service.ts';
import type { TransactionService } from '../../../shared/services/transaction.service.ts';
import type { SystemSettingService } from '../../system-setting/system-setting.service.ts';
import type { ProductLockRepository } from '../../../shared/repositories/product-lock.repo.ts';

const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const PUBLISHER = '22222222-2222-4222-8222-222222222222';
const PRODUCT = '33333333-3333-4333-8333-333333333333';
const OFFER = '44444444-4444-4444-8444-444444444444';

describe('OrderService revenue split', () => {
  const productLock = { lockProduct: vi.fn() };
  const repo = {
    findByIdempotencyKey: vi.fn(),
    findOfferProductId: vi.fn(),
    lockOfferForUpdate: vi.fn(),
    lockPurchaseProfiles: vi.fn(),
    debitBalance: vi.fn(),
    creditPublisherBalance: vi.fn(),
    createOrder: vi.fn(),
    findOrderForCustomer: vi.fn(),
  };
  const entitlement = {
    lockForPurchase: vi.fn(),
    activateFromOrder: vi.fn(),
    findSummaryForOrder: vi.fn(),
  };
  // Runs the body straight through: the decorator only needs runInTransaction to exist.
  const transaction = { runInTransaction: vi.fn((fn: () => unknown) => fn()) };
  const settings = { get: vi.fn() };

  const service = () =>
    new OrderService(
      repo as unknown as OrderRepo,
      entitlement as unknown as EntitlementService,
      transaction as unknown as TransactionService,
      settings as unknown as SystemSettingService,
      productLock as unknown as ProductLockRepository,
    );

  const buy = () =>
    service().create({
      data: { productOfferId: OFFER },
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      customerId: CUSTOMER,
    });

  const givenHealthyPurchase = (
    priceAmount: bigint,
    publisherUserId = PUBLISHER,
    publisherActive = true,
  ) => {
    repo.findByIdempotencyKey.mockResolvedValue(null);
    repo.findOfferProductId.mockResolvedValue(PRODUCT);
    productLock.lockProduct.mockResolvedValue({
      id: PRODUCT,
      status: 'ACTIVE',
      publisherUserId,
      publisherActive,
      transactionNow: new Date('2026-11-23T00:00:00.000Z'),
    });
    repo.lockOfferForUpdate.mockResolvedValue({
      id: OFFER,
      type: 'ONE_TIME',
      priceAmount,
      durationDays: null,
    });
    repo.lockPurchaseProfiles.mockResolvedValue({
      customer: { balance: 10_000_000n },
      publisherExists: true,
    });
    entitlement.lockForPurchase.mockResolvedValue(null);
    entitlement.activateFromOrder.mockResolvedValue({ status: 'ACTIVE' });
    entitlement.findSummaryForOrder.mockResolvedValue({ status: 'ACTIVE' });
    repo.debitBalance.mockResolvedValue(1);
    repo.creditPublisherBalance.mockResolvedValue(1);
    repo.createOrder.mockResolvedValue('order-id');
    repo.findOrderForCustomer.mockResolvedValue({
      id: 'order-id',
      status: 'PAID',
      totalAmount: priceAmount,
      paidAt: new Date(),
      createdAt: new Date(),
      productId: PRODUCT,
      productOfferId: OFFER,
      offerSnapshot: {},
      commissionRateBps: 3000,
      commissionAmount: 30_000n,
      publisherAmount: 70_000n,
      Product: { id: PRODUCT, name: 'p', slug: 'p', status: 'ACTIVE' },
    });
    settings.get.mockResolvedValue({ rateBps: 3000 });
  };

  beforeEach(() => vi.clearAllMocks());

  // The guard exists so a Publisher is not debited the full price and credited the price
  // minus commission for something they already own.
  describe('self-purchase', () => {
    beforeEach(() => givenHealthyPurchase(100_000n, CUSTOMER));

    it('is rejected', async () => {
      await expect(buy()).rejects.toMatchObject({ message: 'Error.CannotPurchaseOwnProduct' });
    });

    it('rejects before locking any wallet', async () => {
      await buy().catch(() => undefined);
      expect(repo.lockPurchaseProfiles).not.toHaveBeenCalled();
      expect(repo.debitBalance).not.toHaveBeenCalled();
      expect(repo.creditPublisherBalance).not.toHaveBeenCalled();
    });
  });

  // Blocking a Publisher only flips their account status; their Products stay ACTIVE, so
  // without this guard a stale productOfferId would still pay a blocked seller.
  describe('blocked publisher', () => {
    beforeEach(() => givenHealthyPurchase(100_000n, PUBLISHER, false));

    it('refuses the purchase', async () => {
      await expect(buy()).rejects.toMatchObject({ message: 'Error.ProductNotPurchasable' });
    });

    it('moves no money and locks no wallet', async () => {
      await buy().catch(() => undefined);
      expect(repo.lockPurchaseProfiles).not.toHaveBeenCalled();
      expect(repo.creditPublisherBalance).not.toHaveBeenCalled();
      expect(repo.createOrder).not.toHaveBeenCalled();
    });
  });

  describe('commission rate unavailable', () => {
    beforeEach(() => {
      givenHealthyPurchase(100_000n);
      settings.get.mockRejectedValue(new Error('no row'));
    });

    it('rejects the order', async () => {
      await expect(buy()).rejects.toMatchObject({
        message: 'Error.CommissionRateUnavailable',
      });
    });

    // Never a fallback rate: zero would hand the Publisher everything, a constant would
    // reintroduce the hardcoded commission spec 009 removed.
    it('moves no money', async () => {
      await buy().catch(() => undefined);
      expect(repo.debitBalance).not.toHaveBeenCalled();
      expect(repo.creditPublisherBalance).not.toHaveBeenCalled();
      expect(repo.createOrder).not.toHaveBeenCalled();
    });
  });

  // The whole point of narrowing the catch: a lock timeout must keep its own shape so
  // create() can still map it to OrderOperationTimeout. Converting it to an
  // HttpException here would short-circuit that mapping.
  describe('a database failure while reading the rate', () => {
    beforeEach(() => {
      givenHealthyPurchase(100_000n);
      const timeout = new Prisma.PrismaClientKnownRequestError('timed out', {
        code: 'P2028',
        clientVersion: '7.10.1',
      });
      settings.get.mockRejectedValue(timeout);
    });

    it('is not disguised as a missing commission rate', async () => {
      await expect(buy()).rejects.not.toMatchObject({
        message: 'Error.CommissionRateUnavailable',
      });
    });

    it('reaches the timeout mapping instead', async () => {
      await expect(buy()).rejects.toMatchObject({
        message: 'Error.OrderOperationTimeout',
      });
    });
  });

  describe('a normal purchase', () => {
    beforeEach(async () => {
      givenHealthyPurchase(100_000n);
      await buy();
    });

    it('debits the customer the full price', () => {
      expect(repo.debitBalance).toHaveBeenCalledWith({ customerId: CUSTOMER, amount: 100_000n });
    });

    it('credits the publisher their share', () => {
      expect(repo.creditPublisherBalance).toHaveBeenCalledWith({
        publisherUserId: PUBLISHER,
        amount: 70_000n,
      });
    });

    it('freezes the split on the order', () => {
      expect(repo.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          publisherUserId: PUBLISHER,
          commissionRateBps: 3000,
          commissionAmount: 30_000n,
          publisherAmount: 70_000n,
        }),
      );
    });

    it('locks both wallets in one call', () => {
      expect(repo.lockPurchaseProfiles).toHaveBeenCalledWith({
        customerId: CUSTOMER,
        publisherUserId: PUBLISHER,
      });
    });
  });

  describe('a free product', () => {
    beforeEach(async () => {
      givenHealthyPurchase(0n);
      await buy();
    });

    it('moves no money', () => {
      expect(repo.creditPublisherBalance).not.toHaveBeenCalled();
    });

    // The column is NOT NULL, so resolving the Publisher is unconditional even though
    // locking and crediting their wallet is skipped.
    it('still records who the publisher was', () => {
      expect(repo.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          publisherUserId: PUBLISHER,
          commissionAmount: 0n,
          publisherAmount: 0n,
        }),
      );
    });

    it('does not lock the publisher wallet', () => {
      expect(repo.lockPurchaseProfiles).toHaveBeenCalledWith({
        customerId: CUSTOMER,
        publisherUserId: undefined,
      });
    });
  });

  describe('publisher has no wallet', () => {
    beforeEach(() => {
      givenHealthyPurchase(100_000n);
      repo.lockPurchaseProfiles.mockResolvedValue({
        customer: { balance: 10_000_000n },
        publisherExists: false,
      });
    });

    it('aborts rather than selling with nowhere to put the earnings', async () => {
      await expect(buy()).rejects.toMatchObject({
        message: 'Error.PublisherProfileNotFound',
      });
      expect(repo.debitBalance).not.toHaveBeenCalled();
    });
  });

  describe('insufficient customer balance', () => {
    beforeEach(() => {
      givenHealthyPurchase(100_000n);
      repo.lockPurchaseProfiles.mockResolvedValue({
        customer: { balance: 1n },
        publisherExists: true,
      });
    });

    // The ordering that matters: the credit must come after the balance check, or a failed
    // purchase would have touched the Publisher's wallet first.
    it('never credits the publisher', async () => {
      await buy().catch(() => undefined);
      expect(repo.creditPublisherBalance).not.toHaveBeenCalled();
      expect(repo.createOrder).not.toHaveBeenCalled();
    });
  });
});
