import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { ProductOfferTypeValue } from '../../shared/constants/product-offer.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import type { OfferSnapshotType } from './order.model.ts';

export type LockedOffer = {
  id: string;
  type: ProductOfferTypeValue;
  priceAmount: bigint;
  durationDays: number | null;
};

export type LockedProfile = {
  balance: bigint;
};

// An Order carries the purchase itself: one Product, one offer, one frozen snapshot. The
// API field "item" is built from these columns (see OrderService.toOrderOutput).
const orderSelect = {
  id: true,
  status: true,
  totalAmount: true,
  paidAt: true,
  createdAt: true,
  productId: true,
  productOfferId: true,
  offerSnapshot: true,
  commissionRateBps: true,
  commissionAmount: true,
  publisherAmount: true,
  Product: {
    select: { id: true, name: true, slug: true, status: true },
  },
} satisfies Prisma.OrderSelect;

export type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

// Raw rows: a timestamptz arrives as a Date or a string depending on the driver, and a
// BIGINT as a bigint, a number or a string. Epoch milliseconds carry now() for the same
// reason (see product-offer.repo.ts).
const fromEpochMs = (value: bigint | number | string) => new Date(Number(value));
const toBigInt = (value: bigint | number | string) => BigInt(value);

@Injectable()
export class OrderRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  // Joins the caller's transaction when there is one (TransactionContext).
  private get prisma() {
    return this.prismaService.getClient();
  }

  // ---- Locks, in the shared order Product -> ProductOffer -> Profile -> Entitlement ----

  // Unlocked on purpose: the client sends only an offer id, and locking has to start at
  // the Product. lockOfferForUpdate re-checks the offer once the Product is held.
  async findOfferProductId(productOfferId: string): Promise<string | null> {
    const row = await this.prisma.productOffer.findFirst({
      where: { id: productOfferId, deletedAt: null },
      select: { productId: true },
    });
    return row?.productId ?? null;
  }

  // Re-reads the offer under lock: the publisher may have replaced the price list between
  // findOfferProductId and the Product lock.
  async lockOfferForUpdate(
    productOfferId: string,
    productId: string,
  ): Promise<LockedOffer | null> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        type: ProductOfferTypeValue;
        priceAmount: bigint | number | string;
        durationDays: number | null;
      }[]
    >`
      SELECT id, type, "priceAmount", "durationDays"
      FROM "ProductOffer"
      WHERE id = ${productOfferId}::uuid
        AND "productId" = ${productId}::uuid
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          type: row.type,
          priceAmount: toBigInt(row.priceAmount),
          durationDays: row.durationDays,
        }
      : null;
  }

  // Serializes every purchase of one customer, which is what makes the idempotency probe
  // and the balance arithmetic safe.
  //
  // Locks the Publisher's row in the same statement, ORDER BY "userId": a purchase now
  // holds two Profile rows, and two transactions taking them in opposite directions is
  // exactly what deadlocks. Every transaction agrees on ascending userId, so they queue.
  // Self-purchase is rejected before this runs, so the two ids are never equal.
  //
  // publisherUserId is omitted when the Publisher receives nothing (free product, or a
  // 100% rate): taking a subset of an agreed lock order cannot deadlock.
  async lockPurchaseProfiles(input: {
    customerId: string;
    publisherUserId?: string;
  }): Promise<{ customer: LockedProfile | null; publisherExists: boolean }> {
    const userIds = input.publisherUserId
      ? [input.customerId, input.publisherUserId]
      : [input.customerId];
    const rows = await this.prisma.$queryRaw<
      { userId: string; balance: bigint | number | string }[]
    >`
      SELECT p."userId", p.balance
      FROM "Profile" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p."userId" = ANY(${userIds}::uuid[])
        AND p."deletedAt" IS NULL
        AND u."deletedAt" IS NULL
      ORDER BY p."userId"
      FOR UPDATE OF p
    `;
    const customerRow = rows.find((row) => row.userId === input.customerId);
    return {
      customer: customerRow ? { balance: toBigInt(customerRow.balance) } : null,
      publisherExists:
        !input.publisherUserId || rows.some((row) => row.userId === input.publisherUserId),
    };
  }

  // ---- Writes ----

  // Conditional in the statement itself, so a concurrent top-up or purchase can never
  // drive the balance below zero. Returns the balance left after the debit, or null when
  // no row matched. The balance comes from the statement that changed it: reading it back
  // separately would let two concurrent purchases record the same figure in the ledger.
  async debitBalance({
    customerId,
    amount,
  }: {
    customerId: string;
    amount: bigint;
  }): Promise<bigint | null> {
    const rows = await this.prisma.profile.updateManyAndReturn({
      where: { userId: customerId, deletedAt: null, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
      select: { balance: true },
    });
    return rows[0]?.balance ?? null;
  }

  // Unconditional, unlike the customer debit: a credit has no lower bound to violate.
  // Returns the balance after the credit, same shape as debitBalance above.
  async creditPublisherBalance({
    publisherUserId,
    amount,
  }: {
    publisherUserId: string;
    amount: bigint;
  }): Promise<bigint | null> {
    const rows = await this.prisma.profile.updateManyAndReturn({
      where: { userId: publisherUserId, deletedAt: null },
      data: { balance: { increment: amount } },
      select: { balance: true },
    });
    return rows[0]?.balance ?? null;
  }

  async createOrder(input: {
    customerId: string;
    idempotencyKey: string;
    paidAt: Date;
    totalAmount: bigint;
    productId: string;
    productOfferId: string;
    offerSnapshot: OfferSnapshotType;
    publisherUserId: string;
    commissionRateBps: number;
    commissionAmount: bigint;
    publisherAmount: bigint;
  }): Promise<string> {
    const offerSnapshot: Prisma.InputJsonObject = input.offerSnapshot;
    const order = await this.prisma.order.create({
      data: {
        customerId: input.customerId,
        idempotencyKey: input.idempotencyKey,
        paidAt: input.paidAt,
        totalAmount: input.totalAmount,
        productId: input.productId,
        productOfferId: input.productOfferId,
        offerSnapshot,
        publisherUserId: input.publisherUserId,
        commissionRateBps: input.commissionRateBps,
        commissionAmount: input.commissionAmount,
        publisherAmount: input.publisherAmount,
      },
      select: { id: true },
    });
    return order.id;
  }

  // ---- Reads ----

  // The unique (customerId, idempotencyKey) index answers this in one lookup; the select
  // carries productOfferId so a replay can be told from a reused key.
  findByIdempotencyKey({
    customerId,
    idempotencyKey,
  }: {
    customerId: string;
    idempotencyKey: string;
  }): Promise<OrderRow | null> {
    return this.prisma.order.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
      select: orderSelect,
    });
  }

  // Newest first, with id as the tie-break so paging stays stable when two Orders share a
  // createdAt. Follows the ("customerId", "createdAt" DESC) index.
  async listMine(input: {
    customerId: string;
    skip: number;
    take: number;
  }): Promise<{ rows: OrderRow[]; totalItems: number }> {
    const where = { customerId: input.customerId };
    const [totalItems, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: orderSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: input.skip,
        take: input.take,
      }),
    ]);
    return { rows, totalItems };
  }

  // One customer's own Order. An Order of someone else answers null, which the service
  // turns into the same "not found" as an id that never existed.
  findOrderForCustomer({
    orderId,
    customerId,
  }: {
    orderId: string;
    customerId: string;
  }): Promise<OrderRow | null> {
    return this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: orderSelect,
    });
  }
}
