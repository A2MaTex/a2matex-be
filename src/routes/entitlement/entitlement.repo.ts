import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import {
  ENTITLEMENT_GRANT_SNAPSHOT,
  EntitlementGrantSource,
  EntitlementStatus,
} from '../../shared/constants/entitlement.constant.ts';
import type {
  EntitlementGrantSourceValue,
  EntitlementStatusValue,
} from '../../shared/constants/entitlement.constant.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import type { EntitlementAuditEntryType } from './entitlement.model.ts';



export type LockedEntitlement = {
  id: string;
  customerId: string;
  status: EntitlementStatusValue;
  grantSource: EntitlementGrantSourceValue;
  startsAt: Date;
  expiresAt: Date | null;
  oneTimePurchasedAt: Date | null;
  revokedAt: Date | null;
  revokedById: string | null;
  revokedReason: string | null;
  transactionNow: Date;
};

export type EntitlementUsageRow = {
  id: string;
  status: EntitlementStatusValue;
  expired: boolean;
  productStatus: ProductStatusType;
  productDeleted: boolean;
};

const adminSelect = {
  id: true,
  customerId: true,
  productId: true,
  status: true,
  grantSource: true,
  grantedById: true,
  startsAt: true,
  expiresAt: true,
  latestProductOfferId: true,
  latestOrderId: true,
  oneTimePurchasedAt: true,
  revokedAt: true,
  revokedById: true,
  revokedReason: true,
  auditHistory: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EntitlementSelect;

export type AdminEntitlementRow = Prisma.EntitlementGetPayload<{ select: typeof adminSelect }>;

const myEntitlementSelect = {
  id: true,
  status: true,
  grantSource: true,
  startsAt: true,
  expiresAt: true,
  Product: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      PublisherAccount: {
        select: {
          user: {
            select: {
              username: true,
              profile: { select: { fullName: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.EntitlementSelect;

export type MyEntitlementRow = Prisma.EntitlementGetPayload<{ select: typeof myEntitlementSelect }>;

// Raw rows: a timestamptz arrives as a Date or a string depending on the driver, so every
// one goes through toDate. Epoch milliseconds carry now() for the same reason.
type RawLockedEntitlement = {
  id: string;
  customerId: string;
  status: EntitlementStatusValue;
  grantSource: EntitlementGrantSourceValue;
  startsAt: Date | string;
  expiresAt: Date | string | null;
  oneTimePurchasedAt: Date | string | null;
  revokedAt: Date | string | null;
  revokedById: string | null;
  revokedReason: string | null;
  transactionNowMs: bigint | number | string;
};

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));
const toNullableDate = (value: Date | string | null) => (value === null ? null : toDate(value));
const fromEpochMs = (value: bigint | number | string) => new Date(Number(value));

@Injectable()
export class EntitlementRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  // Joins the caller's transaction when there is one (TransactionContext), which is how
  // the Order module reuses these methods inside its purchase transaction.
  private get prisma() {
    return this.prismaService.getClient();
  }

  async getDatabaseNow(): Promise<Date> {
    const rows = await this.prisma.$queryRaw<{ nowMs: bigint | number | string }[]>`
      SELECT (EXTRACT(EPOCH FROM now()) * 1000)::bigint AS "nowMs"
    `;
    return fromEpochMs(rows[0]!.nowMs);
  }

  // ---- Locks, in the shared order Product -> ProductOffer -> Profile -> Entitlement ----


  // Serializes every entitlement change of one customer, including the very first one
  // when there is no Entitlement row to lock yet.
  async lockCustomerProfile(customerId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id
      FROM "Profile" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p."userId" = ${customerId}::uuid
        AND p."deletedAt" IS NULL
        AND u."deletedAt" IS NULL
      FOR UPDATE OF p
    `;
    return rows.length > 0;
  }

  async findByCustomerProductForUpdate(
    customerId: string,
    productId: string,
  ): Promise<LockedEntitlement | null> {
    const rows = await this.prisma.$queryRaw<RawLockedEntitlement[]>`
      SELECT id, "customerId", status, "grantSource", "startsAt", "expiresAt",
             "oneTimePurchasedAt", "revokedAt", "revokedById", "revokedReason",
             (EXTRACT(EPOCH FROM now()) * 1000)::bigint AS "transactionNowMs"
      FROM "Entitlement"
      WHERE "customerId" = ${customerId}::uuid
        AND "productId" = ${productId}::uuid
      FOR UPDATE
    `;
    return rows[0] ? this.toLocked(rows[0]) : null;
  }

  async lockByIdForUpdate(id: string): Promise<LockedEntitlement | null> {
    const rows = await this.prisma.$queryRaw<RawLockedEntitlement[]>`
      SELECT id, "customerId", status, "grantSource", "startsAt", "expiresAt",
             "oneTimePurchasedAt", "revokedAt", "revokedById", "revokedReason",
             (EXTRACT(EPOCH FROM now()) * 1000)::bigint AS "transactionNowMs"
      FROM "Entitlement"
      WHERE id = ${id}::uuid
      FOR UPDATE
    `;
    return rows[0] ? this.toLocked(rows[0]) : null;
  }

  async findCustomerIdById(id: string): Promise<string | null> {
    const row = await this.prisma.entitlement.findUnique({
      where: { id },
      select: { customerId: true },
    });
    return row?.customerId ?? null;
  }

  // ---- Admin grant / revoke ----

  async insertFromAdminGrant(input: {
    customerId: string;
    productId: string;
    startsAt: Date;
    expiresAt: Date | null;
    grantedById: string;
    auditEntry: EntitlementAuditEntryType;
  }): Promise<string> {
    const row = await this.prisma.entitlement.create({
      data: {
        customerId: input.customerId,
        productId: input.productId,
        status: EntitlementStatus.ACTIVE,
        grantSource: EntitlementGrantSource.ADMIN_GRANT,
        grantedById: input.grantedById,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        grantSnapshot: ENTITLEMENT_GRANT_SNAPSHOT,
        auditHistory: [input.auditEntry],
      },
      select: { id: true },
    });
    return row.id;
  }

  // Purchase history (latest order item/offer, one-time timestamp) is deliberately left
  // alone: an Admin grant resets the period, not what the customer bought.
  async overwriteFromAdminGrant(input: {
    id: string;
    startsAt: Date;
    expiresAt: Date | null;
    grantedById: string;
    auditEntry: EntitlementAuditEntryType;
  }): Promise<void> {
    const auditEntry: Prisma.InputJsonObject = input.auditEntry;
    const grantSnapshot: Prisma.InputJsonObject = ENTITLEMENT_GRANT_SNAPSHOT;
    await this.prisma.$executeRaw`
      UPDATE "Entitlement"
      SET status = 'ACTIVE',
          "grantSource" = 'ADMIN_GRANT',
          "grantedById" = ${input.grantedById}::uuid,
          "startsAt" = ${input.startsAt}::timestamptz,
          "expiresAt" = ${input.expiresAt}::timestamptz,
          "grantSnapshot" = ${grantSnapshot}::jsonb,
          "revokedAt" = NULL,
          "revokedById" = NULL,
          "revokedReason" = NULL,
          "auditHistory" = COALESCE("auditHistory", '[]'::jsonb) || jsonb_build_array(${auditEntry}::jsonb),
          "updatedAt" = now()
      WHERE id = ${input.id}::uuid
    `;
  }

  // The period and purchase history stay as they were; only access is withdrawn.
  async revoke(input: {
    id: string;
    revokedAt: Date;
    revokedById: string;
    reason: string;
    auditEntry: EntitlementAuditEntryType;
  }): Promise<void> {
    const auditEntry: Prisma.InputJsonObject = input.auditEntry;
    await this.prisma.$executeRaw`
      UPDATE "Entitlement"
      SET status = 'REVOKED',
          "revokedAt" = ${input.revokedAt}::timestamptz,
          "revokedById" = ${input.revokedById}::uuid,
          "revokedReason" = ${input.reason},
          "auditHistory" = COALESCE("auditHistory", '[]'::jsonb) || jsonb_build_array(${auditEntry}::jsonb),
          "updatedAt" = now()
      WHERE id = ${input.id}::uuid
    `;
  }

  // ---- Reads ----

  findAdminById(id: string): Promise<AdminEntitlementRow> {
    return this.prisma.entitlement.findUniqueOrThrow({ where: { id }, select: adminSelect });
  }

  // Read-only lookup used by the Order module for its response (spec 007 R8).
  findForOrderSummary(
    customerId: string,
    productId: string,
  ): Promise<{
    id: string;
    status: EntitlementStatusValue;
    startsAt: Date;
    expiresAt: Date | null;
  } | null> {
    return this.prisma.entitlement.findUnique({
      where: { customerId_productId: { customerId, productId } },
      select: { id: true, status: true, startsAt: true, expiresAt: true },
    });
  }

  async listAdmin(input: {
    customerId?: string;
    productId?: string;
    skip: number;
    take: number;
  }): Promise<{ rows: AdminEntitlementRow[]; totalItems: number }> {
    const where: Prisma.EntitlementWhereInput = {
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.productId ? { productId: input.productId } : {}),
    };
    const [totalItems, rows] = await Promise.all([
      this.prisma.entitlement.count({ where }),
      this.prisma.entitlement.findMany({
        where,
        select: adminSelect,
        orderBy: [
          { updatedAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'asc' },
        ],
        skip: input.skip,
        take: input.take,
      }),
    ]);
    return { rows, totalItems };
  }

  async listMine(input: {
    customerId: string;
    skip: number;
    take: number;
  }): Promise<{ rows: MyEntitlementRow[]; totalItems: number }> {
    const where: Prisma.EntitlementWhereInput = { customerId: input.customerId };
    const [totalItems, rows] = await Promise.all([
      this.prisma.entitlement.count({ where }),
      this.prisma.entitlement.findMany({
        where,
        select: myEntitlementSelect,
        orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
        skip: input.skip,
        take: input.take,
      }),
    ]);
    return { rows, totalItems };
  }

  // One statement so the expiry comparison uses the database clock.
  async findUsage(customerId: string, productId: string): Promise<EntitlementUsageRow | null> {
    const rows = await this.prisma.$queryRaw<EntitlementUsageRow[]>`
      SELECT e.id,
             e.status,
             (e."expiresAt" IS NOT NULL AND e."expiresAt" <= now()) AS expired,
             p.status AS "productStatus",
             (p."deletedAt" IS NOT NULL) AS "productDeleted"
      FROM "Entitlement" e
      JOIN "Product" p ON p.id = e."productId"
      WHERE e."customerId" = ${customerId}::uuid
        AND e."productId" = ${productId}::uuid
    `;
    return rows[0] ?? null;
  }

  // ---- Order contract (FR-011) ----

  // Creates or reactivates the single row. No audit entry: the Order is the history.
  async upsertFromOrder(input: {
    customerId: string;
    productId: string;
    orderId: string;
    productOfferId: string;
    isOneTime: boolean;
    startsAt: Date;
    expiresAt: Date | null;
  }): Promise<{ id: string; startsAt: Date; expiresAt: Date | null }> {
    const grantSnapshot: Prisma.InputJsonObject = ENTITLEMENT_GRANT_SNAPSHOT;
    const oneTimePurchasedAt = input.isOneTime ? input.startsAt : null;
    const rows = await this.prisma.$queryRaw<
      { id: string; startsAt: Date | string; expiresAt: Date | string | null }[]
    >`
      INSERT INTO "Entitlement" (
        "customerId", "productId", status, "grantSource", "grantedById", "startsAt", "expiresAt",
        "latestOrderId", "latestProductOfferId", "oneTimePurchasedAt", "grantSnapshot"
      )
      VALUES (
        ${input.customerId}::uuid, ${input.productId}::uuid, 'ACTIVE', 'ORDER', NULL,
        ${input.startsAt}::timestamptz, ${input.expiresAt}::timestamptz,
        ${input.orderId}::uuid, ${input.productOfferId}::uuid,
        ${oneTimePurchasedAt}::timestamptz, ${grantSnapshot}::jsonb
      )
      ON CONFLICT ("customerId", "productId") DO UPDATE
      SET status = 'ACTIVE',
          "grantSource" = 'ORDER',
          "grantedById" = NULL,
          "startsAt" = EXCLUDED."startsAt",
          "expiresAt" = EXCLUDED."expiresAt",
          "latestOrderId" = EXCLUDED."latestOrderId",
          "latestProductOfferId" = EXCLUDED."latestProductOfferId",
          "oneTimePurchasedAt" = COALESCE("Entitlement"."oneTimePurchasedAt", EXCLUDED."oneTimePurchasedAt"),
          "grantSnapshot" = EXCLUDED."grantSnapshot",
          "updatedAt" = now()
      RETURNING id, "startsAt", "expiresAt"
    `;
    const row = rows[0]!;
    return { id: row.id, startsAt: toDate(row.startsAt), expiresAt: toNullableDate(row.expiresAt) };
  }

  private toLocked(row: RawLockedEntitlement): LockedEntitlement {
    return {
      id: row.id,
      customerId: row.customerId,
      status: row.status,
      grantSource: row.grantSource,
      startsAt: toDate(row.startsAt),
      expiresAt: toNullableDate(row.expiresAt),
      oneTimePurchasedAt: toNullableDate(row.oneTimePurchasedAt),
      revokedAt: toNullableDate(row.revokedAt),
      revokedById: row.revokedById,
      revokedReason: row.revokedReason,
      transactionNow: fromEpochMs(row.transactionNowMs),
    };
  }
}
