import { ConflictException } from '@nestjs/common';
import { TransactionService } from '../../../shared/services/transaction.service.ts';
import { ProductOfferService } from '../../product-offer/product-offer.service.ts';
import { ProductReleaseManagementService } from '../../product-release/product-release.service.ts';
import { ProductAccessPolicy } from '../product-access.policy.ts';
import { ProductRepo } from '../product.repo.ts';
import { ProductService } from '../product.service.ts';

vi.mock('../../../shared/services/transaction.service.ts', () => ({
  TransactionService: class TransactionService {},
}));
vi.mock('../../product-offer/product-offer.service.ts', () => ({
  ProductOfferService: class ProductOfferService {},
}));
vi.mock('../../product-release/product-release.service.ts', () => ({
  ProductReleaseManagementService: class ProductReleaseManagementService {},
}));
vi.mock('../product-access.policy.ts', () => ({ ProductAccessPolicy: class ProductAccessPolicy {} }));
vi.mock('../product.repo.ts', () => ({ ProductRepo: class ProductRepo {} }));

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const RELEASE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-18T09:00:00.000Z');

describe('ProductService lifecycle', () => {
  const lockProduct = vi.fn();
  const setStatus = vi.fn();
  const suspend = vi.fn();
  const assertCurrentReleaseEligible = vi.fn();
  const assertActivationReady = vi.fn();
  const recordInitialPublicConfiguration = vi.fn();
  const runInTransaction = vi.fn((callback: () => unknown) => callback());
  let service: ProductService;

  const locked = (status: string, currentReleaseId: string | null = RELEASE_ID) => ({
    id: PRODUCT_ID,
    status,
    currentReleaseId,
    transactionNow: NOW,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    lockProduct.mockResolvedValue(locked('DRAFT'));
    service = new ProductService(
      { lockProduct, setStatus, suspend } as unknown as ProductRepo,
      {
        resolveLifecycleAccess: async () => ({ unrestricted: false, publisherAccountId: 'pub' }),
        resolveModerationAccess: () => ({ unrestricted: true }),
      } as unknown as ProductAccessPolicy,
      { runInTransaction } as unknown as TransactionService,
      {
        assertActivationReady,
        recordInitialPublicConfiguration,
      } as unknown as ProductOfferService,
      { assertCurrentReleaseEligible } as unknown as ProductReleaseManagementService,
    );
  });

  const lifecycle = (action: string) =>
    service.applyLifecycle({ id: PRODUCT_ID, data: { action } as never, userId: USER_ID, scopes: ['OWN'] });
  const moderate = (action: string, reason?: string) =>
    service.applyModeration({ id: PRODUCT_ID, data: { action, reason } as never, userId: USER_ID, scopes: [null] });

  it('activates only after the release and the offer both pass', async () => {
    await lifecycle('ACTIVATE');

    expect(assertCurrentReleaseEligible).toHaveBeenCalledWith({
      productId: PRODUCT_ID,
      releaseId: RELEASE_ID,
    });
    expect(assertActivationReady).toHaveBeenCalledWith(PRODUCT_ID);
    expect(setStatus).toHaveBeenCalledWith({ id: PRODUCT_ID, status: 'ACTIVE', userId: USER_ID });
    expect(recordInitialPublicConfiguration).toHaveBeenCalledWith({
      productId: PRODUCT_ID,
      occurredAt: NOW,
    });
  });

  it('refuses to activate a Product with no current release', async () => {
    lockProduct.mockResolvedValue(locked('DRAFT', null));

    await expect(lifecycle('ACTIVATE')).rejects.toThrow(ConflictException);
    expect(assertCurrentReleaseEligible).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('reactivates without seeding the offer window again', async () => {
    lockProduct.mockResolvedValue(locked('ARCHIVED'));

    await lifecycle('REACTIVATE');

    expect(assertActivationReady).toHaveBeenCalledWith(PRODUCT_ID);
    expect(setStatus).toHaveBeenCalledWith({ id: PRODUCT_ID, status: 'ACTIVE', userId: USER_ID });
    expect(recordInitialPublicConfiguration).not.toHaveBeenCalled();
  });

  it.each([
    ['ACTIVATE', 'ACTIVE'],
    ['ARCHIVE', 'ARCHIVED'],
    ['REACTIVATE', 'ACTIVE'],
  ])('treats %s as idempotent once the Product is %s', async (action, status) => {
    lockProduct.mockResolvedValue(locked(status));

    await expect(lifecycle(action)).resolves.toBeDefined();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['ACTIVATE', 'ARCHIVED'],
    ['ARCHIVE', 'DRAFT'],
    ['REACTIVATE', 'DRAFT'],
  ])('rejects %s from %s', async (action, status) => {
    lockProduct.mockResolvedValue(locked(status));

    await expect(lifecycle(action)).rejects.toThrow(ConflictException);
    expect(setStatus).not.toHaveBeenCalled();
  });

  // Each role may only undo its own decision.
  it('blocks every Publisher action once Admin has suspended the Product', async () => {
    lockProduct.mockResolvedValue(locked('SUSPENDED'));

    await expect(lifecycle('ARCHIVE')).rejects.toThrow(ConflictException);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('blocks Admin moderation once the Publisher has archived the Product', async () => {
    lockProduct.mockResolvedValue(locked('ARCHIVED'));

    await expect(moderate('SUSPEND', 'policy')).rejects.toThrow(ConflictException);
    expect(suspend).not.toHaveBeenCalled();
  });

  it('suspends an active Product with the stated reason', async () => {
    lockProduct.mockResolvedValue(locked('ACTIVE'));

    await moderate('SUSPEND', 'policy violation');

    expect(suspend).toHaveBeenCalledWith({
      id: PRODUCT_ID,
      userId: USER_ID,
      reason: 'policy violation',
    });
  });

  it('revalidates readiness on an Admin reactivation', async () => {
    lockProduct.mockResolvedValue(locked('SUSPENDED'));

    await moderate('REACTIVATE');

    expect(assertCurrentReleaseEligible).toHaveBeenCalled();
    expect(assertActivationReady).toHaveBeenCalledWith(PRODUCT_ID);
    expect(recordInitialPublicConfiguration).not.toHaveBeenCalled();
  });
});
