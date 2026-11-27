import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EntitlementAuditAction,
  EntitlementEffectiveStatus,
  EntitlementGrantSource,
  EntitlementStatus,
  EntitlementUsageDenyReason,
  MILLISECONDS_PER_DAY,
} from '../../shared/constants/entitlement.constant.ts';
import type {
  EntitlementEffectiveStatusValue,
  EntitlementStatusValue,
} from '../../shared/constants/entitlement.constant.ts';
import { ProductOfferType } from '../../shared/constants/product-offer.constant.ts';
import type { ProductOfferTypeValue } from '../../shared/constants/product-offer.constant.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { ProductLockRepository } from '../../shared/repositories/product-lock.repo.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import {
  isTransactionTimeoutPrismaError,
  isUniqueConstraintPrismaError,
} from '../../shared/utils/prisma.ts';
import { ProductNotFoundException } from '../product/product.error.ts';
import {
  EntitlementAlreadyRevokedException,
  EntitlementCustomerNotFoundException,
  EntitlementInvalidExpiresAtException,
  EntitlementNotFoundException,
  EntitlementOperationTimeoutException,
  EntitlementProductNotActiveException,
} from './entitlement.error.ts';
import type {
  AdminEntitlementOutputType,
  EntitlementAuditEntryType,
  EntitlementSummaryForOrderType,
  EntitlementStateSnapshotType,
  GetAdminEntitlementsInputType,
  GetAdminEntitlementsOutputType,
  GetMyEntitlementsInputType,
  GetMyEntitlementsOutputType,
  GrantEntitlementInputType,
  LockedPurchaseEntitlement,
  UsageCheck,
} from './entitlement.model.ts';
import { EntitlementRepo } from './entitlement.repo.ts';
import type {
  AdminEntitlementRow,
  LockedEntitlement,
  EntitlementUsageRow,
} from './entitlement.repo.ts';

// REVOKED wins over time; otherwise a past "expiresAt" means EXPIRED. `now` is always the
// database clock, never this process's.
export function toEffectiveStatus(
  status: EntitlementStatusValue,
  expiresAt: Date | null,
  now: Date,
): EntitlementEffectiveStatusValue {
  if (status === EntitlementStatus.REVOKED) {
    return EntitlementEffectiveStatus.REVOKED;
  }
  if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
    return EntitlementEffectiveStatus.EXPIRED;
  }
  return EntitlementEffectiveStatus.ACTIVE;
}

function toSnapshot(entitlement: LockedEntitlement): EntitlementStateSnapshotType {
  return {
    status: entitlement.status,
    grantSource: entitlement.grantSource,
    startsAt: entitlement.startsAt.toISOString(),
    expiresAt: entitlement.expiresAt?.toISOString() ?? null,
    ...(entitlement.status === EntitlementStatus.REVOKED
      ? {
          revokedAt: entitlement.revokedAt!.toISOString(),
          revokedById: entitlement.revokedById!,
          revokedReason: entitlement.revokedReason!,
        }
      : {}),
  };
}

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  constructor(
    @Inject(EntitlementRepo) private readonly entitlementRepo: EntitlementRepo,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
    @Inject(ProductLockRepository) private readonly productLockRepo: ProductLockRepository,
  ) {}

  // ---- Admin grant (US1) ----

  async grant(input: {
    data: GrantEntitlementInputType;
    adminUserId: string;
  }): Promise<AdminEntitlementOutputType> {
    try {
      return await this.grantInTransaction(input);
    } catch (error) {
      throw this.translateWriteError(error, 'grant');
    }
  }

  @Transactional()
  private async grantInTransaction({
    data,
    adminUserId,
  }: {
    data: GrantEntitlementInputType;
    adminUserId: string;
  }): Promise<AdminEntitlementOutputType> {
    const { customerId, productId, expiresAt, reason } = data;

    // Does not consult product.publisherActive on purpose: an Admin grant moves no money
    // and is a deliberate override, so it must stay possible to compensate a customer for
    // a Product whose Publisher has since been blocked. The purchase path, where money
    // does move, refuses that case.
    const product = await this.productLockRepo.lockProduct(productId);
    if (!product) {
      throw ProductNotFoundException;
    }
    // Clarification 2026-11-21: Admin grants only for a Product that is on sale.
    if (product.status !== ProductStatus.ACTIVE) {
      this.logger.warn(
        `Entitlement grant rejected: Error.EntitlementProductNotActive productId=${productId} status=${product.status}`,
      );
      throw EntitlementProductNotActiveException;
    }

    if (!(await this.entitlementRepo.lockCustomerProfile(customerId))) {
      throw EntitlementCustomerNotFoundException;
    }

    const now = product.transactionNow;
    if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
      throw EntitlementInvalidExpiresAtException;
    }

    const current = await this.entitlementRepo.findByCustomerProductForUpdate(
      customerId,
      productId,
    );
    const auditEntry: EntitlementAuditEntryType = {
      action: EntitlementAuditAction.GRANT,
      reason,
      actedAt: now.toISOString(),
      actedById: adminUserId,
      before: current ? toSnapshot(current) : null,
      after: {
        status: EntitlementStatus.ACTIVE,
        grantSource: EntitlementGrantSource.ADMIN_GRANT,
        startsAt: now.toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    };

    let entitlementId: string;
    if (current) {
      await this.entitlementRepo.overwriteFromAdminGrant({
        id: current.id,
        startsAt: now,
        expiresAt,
        grantedById: adminUserId,
        auditEntry,
      });
      entitlementId = current.id;
    } else {
      entitlementId = await this.entitlementRepo.insertFromAdminGrant({
        customerId,
        productId,
        startsAt: now,
        expiresAt,
        grantedById: adminUserId,
        auditEntry,
      });
    }

    this.logger.log(
      `Entitlement grant committed entitlementId=${entitlementId} customerId=${customerId} ` +
        `productId=${productId} adminUserId=${adminUserId} created=${current === null}`,
    );

    return this.toAdminOutput(await this.entitlementRepo.findAdminById(entitlementId), now);
  }

  // ---- Admin revoke (US3) ----

  async revoke(input: {
    entitlementId: string;
    reason: string;
    adminUserId: string;
  }): Promise<AdminEntitlementOutputType> {
    try {
      return await this.revokeInTransaction(input);
    } catch (error) {
      throw this.translateWriteError(error, 'revoke');
    }
  }

  @Transactional()
  private async revokeInTransaction({
    entitlementId,
    reason,
    adminUserId,
  }: {
    entitlementId: string;
    reason: string;
    adminUserId: string;
  }): Promise<AdminEntitlementOutputType> {
    const customerId = await this.entitlementRepo.findCustomerIdById(entitlementId);
    if (!customerId) {
      throw EntitlementNotFoundException;
    }

    // Same lock order as grant and purchase. Revoke does not depend on the Product state,
    // so the Product row is not locked.
    await this.entitlementRepo.lockCustomerProfile(customerId);
    const current = await this.entitlementRepo.lockByIdForUpdate(entitlementId);
    if (!current) {
      throw EntitlementNotFoundException;
    }
    if (current.status === EntitlementStatus.REVOKED) {
      throw EntitlementAlreadyRevokedException;
    }

    const now = current.transactionNow;
    const before = toSnapshot(current);
    const auditEntry: EntitlementAuditEntryType = {
      action: EntitlementAuditAction.REVOKE,
      reason,
      actedAt: now.toISOString(),
      actedById: adminUserId,
      before,
      after: {
        ...before,
        status: EntitlementStatus.REVOKED,
        revokedAt: now.toISOString(),
        revokedById: adminUserId,
        revokedReason: reason,
      },
    };

    await this.entitlementRepo.revoke({
      id: entitlementId,
      revokedAt: now,
      revokedById: adminUserId,
      reason,
      auditEntry,
    });

    this.logger.log(
      `Entitlement revoke committed entitlementId=${entitlementId} customerId=${customerId} ` +
        `adminUserId=${adminUserId}`,
    );

    return this.toAdminOutput(await this.entitlementRepo.findAdminById(entitlementId), now);
  }

  // ---- Reads (US2, US4) ----

  async listMine({
    userId,
    query,
  }: {
    userId: string;
    query: GetMyEntitlementsInputType;
  }): Promise<GetMyEntitlementsOutputType> {
    const { page, pageSize, skip, take } = getPagination(query);
    const [now, { rows, totalItems }] = await Promise.all([
      this.entitlementRepo.getDatabaseNow(),
      this.entitlementRepo.listMine({ customerId: userId, skip, take }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        status: toEffectiveStatus(row.status, row.expiresAt, now),
        grantSource: row.grantSource,
        startsAt: row.startsAt,
        expiresAt: row.expiresAt,
        product: {
          id: row.Product.id,
          name: row.Product.name,
          slug: row.Product.slug,
          status: row.Product.status,
        },
        publisher: {
          username: row.Product.PublisherAccount.user.username,
          displayName: row.Product.PublisherAccount.user.profile?.fullName ?? null,
        },
      })),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  async listAdmin(query: GetAdminEntitlementsInputType): Promise<GetAdminEntitlementsOutputType> {
    const { page, pageSize, skip, take } = getPagination(query);
    const [now, { rows, totalItems }] = await Promise.all([
      this.entitlementRepo.getDatabaseNow(),
      this.entitlementRepo.listAdmin({
        customerId: query.customerId,
        productId: query.productId,
        skip,
        take,
      }),
    ]);

    return {
      items: rows.map((row) => this.toAdminOutput(row, now)),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  // ---- Shared usage check (FR-010) ----

  // Download, Launcher and Execution Lease all ask this; each maps a deny reason to its
  // own error. Release eligibility is theirs to check.
  async checkUsage({
    customerId,
    productId,
  }: {
    customerId: string;
    productId: string;
  }): Promise<UsageCheck> {
    return this.evaluateUsage(await this.entitlementRepo.findUsage(customerId, productId));
  }

  // Joins the issuer's Product -> Release -> Entitlement transaction and reuses usage policy.
  async lockForAuthorization(input: {
    userId: string;
    productId: string;
    productStatus: EntitlementUsageRow['productStatus'];
  }) {
    const row = await this.entitlementRepo.findByCustomerProductForUpdate(
      input.userId,
      input.productId,
    );
    const now = await this.entitlementRepo.getAuthorizationNow();
    const usage = this.evaluateUsage(
      row
        ? {
            id: row.id,
            status: row.status,
            expired: row.expiresAt !== null && row.expiresAt <= now,
            productDeleted: false,
            productStatus: input.productStatus,
          }
        : null,
    );
    if (!usage.usable || !row || row.startsAt > now) return null;
    return { entitlementId: row.id, startsAt: row.startsAt, expiresAt: row.expiresAt, now };
  }

  private evaluateUsage(row: EntitlementUsageRow | null): UsageCheck {
    if (!row) {
      return { usable: false, reason: EntitlementUsageDenyReason.NOT_FOUND };
    }
    if (row.productDeleted) {
      return { usable: false, reason: EntitlementUsageDenyReason.PRODUCT_UNAVAILABLE };
    }
    if (row.status === EntitlementStatus.REVOKED) {
      return { usable: false, reason: EntitlementUsageDenyReason.REVOKED };
    }
    if (row.expired) {
      return { usable: false, reason: EntitlementUsageDenyReason.EXPIRED };
    }
    if (row.productStatus === ProductStatus.SUSPENDED) {
      return { usable: false, reason: EntitlementUsageDenyReason.PRODUCT_SUSPENDED };
    }
    // ARCHIVED only stops discovery and new purchases; existing access keeps working.
    return { usable: true, entitlementId: row.id };
  }

  /**
   * The customer's current access to one Product, for the Order module's response.
   * Read-only and unlocked: it runs after the purchase has committed its changes, or on a
   * replay where nothing is written at all.
   */
  async findSummaryForOrder({
    customerId,
    productId,
  }: {
    customerId: string;
    productId: string;
  }): Promise<EntitlementSummaryForOrderType | null> {
    const row = await this.entitlementRepo.findForOrderSummary(customerId, productId);
    if (!row) {
      return null;
    }

    const now = await this.entitlementRepo.getDatabaseNow();
    return {
      id: row.id,
      status: toEffectiveStatus(row.status, row.expiresAt, now),
      startsAt: row.startsAt,
      expiresAt: row.expiresAt,
    };
  }

  // ---- Order contract (FR-011) ----
  // Neither method opens a transaction: both join the caller's through TransactionContext.

  /**
   * Locks and reads the customer's Entitlement for a purchase. Call only inside the Order
   * transaction, after locking Product -> ProductOffer -> Profile in that order.
   */
  async lockForPurchase({
    customerId,
    productId,
  }: {
    customerId: string;
    productId: string;
  }): Promise<LockedPurchaseEntitlement | null> {
    const row = await this.entitlementRepo.findByCustomerProductForUpdate(customerId, productId);
    return row
      ? {
          id: row.id,
          status: row.status,
          expiresAt: row.expiresAt,
          oneTimePurchasedAt: row.oneTimePurchasedAt,
        }
      : null;
  }

  /**
   * Creates or reactivates the Entitlement for a paid Order. The period starts at the
   * Order's transaction time and never extends an earlier one. Purchase-blocking rules
   * (revoked, still active, one-time already used) belong to the Order module.
   */
  async activateFromOrder(input: {
    customerId: string;
    productId: string;
    orderId: string;
    productOfferId: string;
    offerType: ProductOfferTypeValue;
    durationDays: number | null;
    now: Date;
  }): Promise<{ id: string; startsAt: Date; expiresAt: Date | null }> {
    const expiresAt =
      input.durationDays === null
        ? null
        : new Date(input.now.getTime() + input.durationDays * MILLISECONDS_PER_DAY);

    return this.entitlementRepo.upsertFromOrder({
      customerId: input.customerId,
      productId: input.productId,
      orderId: input.orderId,
      productOfferId: input.productOfferId,
      isOneTime: input.offerType === ProductOfferType.ONE_TIME,
      startsAt: input.now,
      expiresAt,
    });
  }

  // ---- Helpers ----

  private toAdminOutput(row: AdminEntitlementRow, now: Date): AdminEntitlementOutputType {
    return {
      id: row.id,
      customerId: row.customerId,
      productId: row.productId,
      status: toEffectiveStatus(row.status, row.expiresAt, now),
      storedStatus: row.status,
      grantSource: row.grantSource,
      grantedById: row.grantedById,
      startsAt: row.startsAt,
      expiresAt: row.expiresAt,
      latestProductOfferId: row.latestProductOfferId,
      latestOrderId: row.latestOrderId,
      oneTimePurchasedAt: row.oneTimePurchasedAt,
      revokedAt: row.revokedAt,
      revokedById: row.revokedById,
      revokedReason: row.revokedReason,
      auditHistory: Array.isArray(row.auditHistory) ? row.auditHistory : [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private translateWriteError(error: unknown, operation: 'grant' | 'revoke'): unknown {
    if (isTransactionTimeoutPrismaError(error)) {
      this.logger.error(`Entitlement ${operation} timed out waiting for a row lock`);
      return EntitlementOperationTimeoutException;
    }
    // The Profile lock serializes a customer's entitlement writes, so a duplicate
    // (customer, Product) here is a broken invariant, not a client error.
    if (isUniqueConstraintPrismaError(error)) {
      this.logger.error(`Entitlement ${operation} hit the (customerId, productId) unique key`);
    }
    return error;
  }
}
