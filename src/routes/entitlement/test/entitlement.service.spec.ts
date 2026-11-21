import { Prisma } from '../../../generated/prisma/client.ts';
import type { TransactionService } from '../../../shared/services/transaction.service.ts';
import { ProductNotFoundException } from '../../product/product.error.ts';
import {
  EntitlementAlreadyRevokedException,
  EntitlementCustomerNotFoundException,
  EntitlementInvalidExpiresAtException,
  EntitlementNotFoundException,
  EntitlementOperationTimeoutException,
  EntitlementProductNotActiveException,
} from '../entitlement.error.ts';
import type { EntitlementRepo, LockedEntitlement } from '../entitlement.repo.ts';
import { EntitlementService, toEffectiveStatus } from '../entitlement.service.ts';

vi.mock('../../../shared/constants/system.constant.ts', () => ({
  DEFAULT_LIMIT: 10,
  DEFAULT_PAGE: 1,
  SUCCESS_RESPONSE_MESSAGE: 'Success',
}));
vi.mock('../../../shared/services/transaction.service.ts', () => ({
  TransactionService: class TransactionService {},
}));
vi.mock('../entitlement.repo.ts', () => ({
  EntitlementRepo: class EntitlementRepo {},
}));

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const ENTITLEMENT_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_ITEM_ID = '55555555-5555-4555-8555-555555555555';
const OFFER_ID = '66666666-6666-4666-8666-666666666666';

const NOW = new Date('2026-11-21T10:00:00.000Z');
const DAY = 86_400_000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);

function lockedEntitlement(overrides: Partial<LockedEntitlement> = {}): LockedEntitlement {
  return {
    id: ENTITLEMENT_ID,
    customerId: CUSTOMER_ID,
    status: 'ACTIVE',
    grantSource: 'ORDER',
    startsAt: inDays(-20),
    expiresAt: inDays(10),
    oneTimePurchasedAt: null,
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    transactionNow: NOW,
    ...overrides,
  };
}

function adminRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTITLEMENT_ID,
    customerId: CUSTOMER_ID,
    productId: PRODUCT_ID,
    status: 'ACTIVE',
    grantSource: 'ADMIN_GRANT',
    grantedById: ADMIN_ID,
    startsAt: NOW,
    expiresAt: inDays(30),
    latestProductOfferId: null,
    latestOrderItemId: null,
    oneTimePurchasedAt: null,
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    auditHistory: [],
    createdAt: NOW,
    updatedAt: null,
    ...overrides,
  };
}

function timeoutError() {
  return new Prisma.PrismaClientKnownRequestError('Transaction timed out', {
    code: 'P2028',
    clientVersion: '7.10.1',
  });
}

describe('toEffectiveStatus', () => {
  it('derives REVOKED before time, then EXPIRED, then ACTIVE', () => {
    expect(toEffectiveStatus('REVOKED', null, NOW)).toBe('REVOKED');
    expect(toEffectiveStatus('REVOKED', inDays(5), NOW)).toBe('REVOKED');
    expect(toEffectiveStatus('ACTIVE', NOW, NOW)).toBe('EXPIRED');
    expect(toEffectiveStatus('ACTIVE', inDays(-1), NOW)).toBe('EXPIRED');
    expect(toEffectiveStatus('ACTIVE', inDays(1), NOW)).toBe('ACTIVE');
    expect(toEffectiveStatus('ACTIVE', null, NOW)).toBe('ACTIVE');
  });
});

describe('EntitlementService', () => {
  const repo = {
    getDatabaseNow: vi.fn(),
    lockProduct: vi.fn(),
    lockCustomerProfile: vi.fn(),
    findByCustomerProductForUpdate: vi.fn(),
    lockByIdForUpdate: vi.fn(),
    findCustomerIdById: vi.fn(),
    insertFromAdminGrant: vi.fn(),
    overwriteFromAdminGrant: vi.fn(),
    revoke: vi.fn(),
    findAdminById: vi.fn(),
    listAdmin: vi.fn(),
    listMine: vi.fn(),
    findUsage: vi.fn(),
    upsertFromOrder: vi.fn(),
  };
  const runInTransaction = vi.fn((callback: () => unknown) => callback());
  let service: EntitlementService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EntitlementService(
      repo as unknown as EntitlementRepo,
      { runInTransaction } as unknown as TransactionService,
    );
    repo.lockProduct.mockResolvedValue({ id: PRODUCT_ID, status: 'ACTIVE', transactionNow: NOW });
    repo.lockCustomerProfile.mockResolvedValue(true);
    repo.findByCustomerProductForUpdate.mockResolvedValue(null);
    repo.insertFromAdminGrant.mockResolvedValue(ENTITLEMENT_ID);
    repo.findAdminById.mockResolvedValue(adminRow());
    repo.getDatabaseNow.mockResolvedValue(NOW);
  });

  const grantInput = (expiresAt: Date | null = inDays(30)) => ({
    data: { customerId: CUSTOMER_ID, productId: PRODUCT_ID, expiresAt, reason: 'UAT' },
    adminUserId: ADMIN_ID,
  });

  describe('grant (US1)', () => {
    it('creates a new Entitlement with an audit entry whose before is null', async () => {
      const result = await service.grant(grantInput());

      expect(runInTransaction).toHaveBeenCalledTimes(1);
      expect(repo.insertFromAdminGrant).toHaveBeenCalledWith({
        customerId: CUSTOMER_ID,
        productId: PRODUCT_ID,
        startsAt: NOW,
        expiresAt: inDays(30),
        grantedById: ADMIN_ID,
        auditEntry: {
          action: 'GRANT',
          reason: 'UAT',
          actedAt: NOW.toISOString(),
          actedById: ADMIN_ID,
          before: null,
          after: {
            status: 'ACTIVE',
            grantSource: 'ADMIN_GRANT',
            startsAt: NOW.toISOString(),
            expiresAt: inDays(30).toISOString(),
          },
        },
      });
      expect(repo.overwriteFromAdminGrant).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        id: ENTITLEMENT_ID,
        status: 'ACTIVE',
        storedStatus: 'ACTIVE',
      });
    });

    it('locks Product, then the customer Profile, then the Entitlement', async () => {
      await service.grant(grantInput());

      const order = [
        repo.lockProduct.mock.invocationCallOrder[0],
        repo.lockCustomerProfile.mock.invocationCallOrder[0],
        repo.findByCustomerProductForUpdate.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a! - b!));
    });

    it('overwrites a shorter-lived purchased period without touching purchase history', async () => {
      repo.findByCustomerProductForUpdate.mockResolvedValue(
        lockedEntitlement({ expiresAt: inDays(60), oneTimePurchasedAt: inDays(-100) }),
      );

      await service.grant(grantInput(inDays(10)));

      expect(repo.insertFromAdminGrant).not.toHaveBeenCalled();
      const call = repo.overwriteFromAdminGrant.mock.calls[0]![0];
      // The repo update has no parameter for latest order item/offer or one-time date.
      expect(Object.keys(call).sort()).toEqual(
        ['auditEntry', 'expiresAt', 'grantedById', 'id', 'startsAt'].sort(),
      );
      expect(call.expiresAt).toEqual(inDays(10));
      expect(call.auditEntry.before).toMatchObject({
        status: 'ACTIVE',
        grantSource: 'ORDER',
        expiresAt: inDays(60).toISOString(),
      });
    });

    it('lifts a revocation and keeps the revocation in the audit entry', async () => {
      repo.findByCustomerProductForUpdate.mockResolvedValue(
        lockedEntitlement({
          status: 'REVOKED',
          revokedAt: inDays(-1),
          revokedById: ADMIN_ID,
          revokedReason: 'policy',
        }),
      );

      await service.grant(grantInput());

      const call = repo.overwriteFromAdminGrant.mock.calls[0]![0];
      expect(call.auditEntry.before).toMatchObject({
        status: 'REVOKED',
        revokedAt: inDays(-1).toISOString(),
        revokedById: ADMIN_ID,
        revokedReason: 'policy',
      });
      expect(call.auditEntry.after.status).toBe('ACTIVE');
    });

    it('accepts a permanent grant', async () => {
      await service.grant(grantInput(null));

      expect(repo.insertFromAdminGrant.mock.calls[0]![0].expiresAt).toBeNull();
    });

    it('rejects a missing Product', async () => {
      repo.lockProduct.mockResolvedValue(null);

      await expect(service.grant(grantInput())).rejects.toBe(ProductNotFoundException);
      expect(repo.lockCustomerProfile).not.toHaveBeenCalled();
    });

    it.each(['DRAFT', 'ARCHIVED', 'SUSPENDED'])('rejects a %s Product', async (status) => {
      repo.lockProduct.mockResolvedValue({ id: PRODUCT_ID, status, transactionNow: NOW });

      await expect(service.grant(grantInput())).rejects.toBe(EntitlementProductNotActiveException);
      expect(repo.insertFromAdminGrant).not.toHaveBeenCalled();
    });

    it('rejects a customer without a live Profile', async () => {
      repo.lockCustomerProfile.mockResolvedValue(false);

      await expect(service.grant(grantInput())).rejects.toBe(EntitlementCustomerNotFoundException);
    });

    it.each([
      ['equal to', NOW],
      ['before', inDays(-1)],
    ])('rejects expiresAt %s the transaction time', async (_label, expiresAt) => {
      await expect(service.grant(grantInput(expiresAt))).rejects.toBe(
        EntitlementInvalidExpiresAtException,
      );
      expect(repo.findByCustomerProductForUpdate).not.toHaveBeenCalled();
    });

    it('maps a lock wait timeout to 503', async () => {
      repo.lockProduct.mockRejectedValue(timeoutError());

      await expect(service.grant(grantInput())).rejects.toBe(EntitlementOperationTimeoutException);
    });
  });

  describe('revoke (US3)', () => {
    const revokeInput = { entitlementId: ENTITLEMENT_ID, reason: 'policy', adminUserId: ADMIN_ID };

    beforeEach(() => {
      repo.findCustomerIdById.mockResolvedValue(CUSTOMER_ID);
      repo.lockByIdForUpdate.mockResolvedValue(lockedEntitlement());
      repo.findAdminById.mockResolvedValue(
        adminRow({
          status: 'REVOKED',
          revokedAt: NOW,
          revokedById: ADMIN_ID,
          revokedReason: 'policy',
        }),
      );
    });

    it.each([
      ['still active', inDays(10)],
      ['already expired', inDays(-1)],
    ])('revokes an Entitlement that is %s and keeps its period', async (_label, expiresAt) => {
      repo.lockByIdForUpdate.mockResolvedValue(lockedEntitlement({ expiresAt }));

      const result = await service.revoke(revokeInput);

      const call = repo.revoke.mock.calls[0]![0];
      expect(call).toMatchObject({
        id: ENTITLEMENT_ID,
        revokedAt: NOW,
        revokedById: ADMIN_ID,
        reason: 'policy',
      });
      expect(Object.keys(call)).not.toContain('expiresAt');
      expect(call.auditEntry).toMatchObject({
        action: 'REVOKE',
        before: { status: 'ACTIVE', expiresAt: expiresAt.toISOString() },
        after: {
          status: 'REVOKED',
          expiresAt: expiresAt.toISOString(),
          revokedAt: NOW.toISOString(),
          revokedById: ADMIN_ID,
          revokedReason: 'policy',
        },
      });
      expect(result.status).toBe('REVOKED');
    });

    it('locks the customer Profile before the Entitlement', async () => {
      await service.revoke(revokeInput);

      expect(repo.lockCustomerProfile).toHaveBeenCalledWith(CUSTOMER_ID);
      expect(repo.lockCustomerProfile.mock.invocationCallOrder[0]).toBeLessThan(
        repo.lockByIdForUpdate.mock.invocationCallOrder[0]!,
      );
      expect(repo.lockProduct).not.toHaveBeenCalled();
    });

    it('rejects an unknown Entitlement', async () => {
      repo.findCustomerIdById.mockResolvedValue(null);

      await expect(service.revoke(revokeInput)).rejects.toBe(EntitlementNotFoundException);
    });

    it('rejects an Entitlement that is already revoked', async () => {
      repo.lockByIdForUpdate.mockResolvedValue(
        lockedEntitlement({
          status: 'REVOKED',
          revokedAt: inDays(-1),
          revokedById: ADMIN_ID,
          revokedReason: 'earlier',
        }),
      );

      await expect(service.revoke(revokeInput)).rejects.toBe(EntitlementAlreadyRevokedException);
      expect(repo.revoke).not.toHaveBeenCalled();
    });
  });

  describe('listMine (US2)', () => {
    it('derives the effective status and exposes no administrative field', async () => {
      const product = {
        id: PRODUCT_ID,
        name: 'Bot',
        slug: 'bot',
        status: 'ARCHIVED',
        PublisherAccount: { user: { username: 'pub', profile: { fullName: 'Publisher' } } },
      };
      repo.listMine.mockResolvedValue({
        totalItems: 21,
        rows: [
          {
            id: 'a',
            status: 'ACTIVE',
            grantSource: 'ORDER',
            startsAt: NOW,
            expiresAt: inDays(1),
            Product: product,
          },
          {
            id: 'b',
            status: 'ACTIVE',
            grantSource: 'ORDER',
            startsAt: NOW,
            expiresAt: inDays(-1),
            Product: product,
          },
          {
            id: 'c',
            status: 'REVOKED',
            grantSource: 'ADMIN_GRANT',
            startsAt: NOW,
            expiresAt: null,
            Product: product,
          },
        ],
      });

      const result = await service.listMine({
        userId: CUSTOMER_ID,
        query: { page: 2, limit: 10 },
      });

      expect(repo.listMine).toHaveBeenCalledWith({ customerId: CUSTOMER_ID, skip: 10, take: 10 });
      expect(result.items.map((item) => item.status)).toEqual(['ACTIVE', 'EXPIRED', 'REVOKED']);
      expect(result).toMatchObject({ totalItems: 21, page: 2, pageSize: 10, totalPages: 3 });
      expect(Object.keys(result.items[0]!).sort()).toEqual(
        ['expiresAt', 'grantSource', 'id', 'product', 'publisher', 'startsAt', 'status'].sort(),
      );
      expect(result.items[0]!.publisher).toEqual({ username: 'pub', displayName: 'Publisher' });
    });
  });

  describe('listAdmin (US4)', () => {
    it('passes the filters through and returns full administrative rows', async () => {
      repo.listAdmin.mockResolvedValue({ totalItems: 1, rows: [adminRow()] });

      const result = await service.listAdmin({ page: 1, limit: 10, customerId: CUSTOMER_ID });

      expect(repo.listAdmin).toHaveBeenCalledWith({
        customerId: CUSTOMER_ID,
        productId: undefined,
        skip: 0,
        take: 10,
      });
      expect(result.items[0]).toMatchObject({ id: ENTITLEMENT_ID, auditHistory: [] });
    });
  });

  describe('checkUsage (FR-010)', () => {
    const usage = (overrides: Record<string, unknown> = {}) => ({
      id: ENTITLEMENT_ID,
      status: 'ACTIVE',
      expired: false,
      productStatus: 'ACTIVE',
      productDeleted: false,
      ...overrides,
    });
    const input = { customerId: CUSTOMER_ID, productId: PRODUCT_ID };

    it.each([
      ['no Entitlement', null, 'NOT_FOUND'],
      ['deleted Product', usage({ productDeleted: true }), 'PRODUCT_UNAVAILABLE'],
      ['revoked, even if not expired', usage({ status: 'REVOKED' }), 'REVOKED'],
      ['expired', usage({ expired: true }), 'EXPIRED'],
      ['suspended Product', usage({ productStatus: 'SUSPENDED' }), 'PRODUCT_SUSPENDED'],
    ])('denies %s', async (_label, row, reason) => {
      repo.findUsage.mockResolvedValue(row);

      await expect(service.checkUsage(input)).resolves.toEqual({ usable: false, reason });
    });

    it.each(['ACTIVE', 'ARCHIVED'])('allows a live Entitlement on a %s Product', async (status) => {
      repo.findUsage.mockResolvedValue(usage({ productStatus: status }));

      await expect(service.checkUsage(input)).resolves.toEqual({
        usable: true,
        entitlementId: ENTITLEMENT_ID,
      });
    });
  });

  describe('Order contract (FR-011)', () => {
    const activate = (overrides: Record<string, unknown> = {}) => ({
      customerId: CUSTOMER_ID,
      productId: PRODUCT_ID,
      orderItemId: ORDER_ITEM_ID,
      productOfferId: OFFER_ID,
      offerType: 'SUBSCRIPTION' as const,
      durationDays: 30 as number | null,
      now: NOW,
      ...overrides,
    });

    beforeEach(() => {
      repo.upsertFromOrder.mockResolvedValue({
        id: ENTITLEMENT_ID,
        startsAt: NOW,
        expiresAt: null,
      });
    });

    it('starts a subscription at the Order time and ends it durationDays later', async () => {
      await service.activateFromOrder(activate());

      expect(repo.upsertFromOrder).toHaveBeenCalledWith({
        customerId: CUSTOMER_ID,
        productId: PRODUCT_ID,
        orderItemId: ORDER_ITEM_ID,
        productOfferId: OFFER_ID,
        isOneTime: false,
        startsAt: NOW,
        expiresAt: inDays(30),
      });
      expect(runInTransaction).not.toHaveBeenCalled();
    });

    it('grants permanent access for a null duration and flags ONE_TIME', async () => {
      await service.activateFromOrder(activate({ offerType: 'ONE_TIME', durationDays: null }));

      expect(repo.upsertFromOrder.mock.calls[0]![0]).toMatchObject({
        isOneTime: true,
        expiresAt: null,
      });
    });

    it('returns null from lockForPurchase when there is no row yet', async () => {
      await expect(
        service.lockForPurchase({ customerId: CUSTOMER_ID, productId: PRODUCT_ID }),
      ).resolves.toBeNull();
    });

    it('returns the locked purchase state when a row exists', async () => {
      repo.findByCustomerProductForUpdate.mockResolvedValue(
        lockedEntitlement({ oneTimePurchasedAt: inDays(-5) }),
      );

      await expect(
        service.lockForPurchase({ customerId: CUSTOMER_ID, productId: PRODUCT_ID }),
      ).resolves.toEqual({
        id: ENTITLEMENT_ID,
        status: 'ACTIVE',
        expiresAt: inDays(10),
        oneTimePurchasedAt: inDays(-5),
      });
    });
  });
});
