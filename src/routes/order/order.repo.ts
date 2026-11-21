import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { ProductOfferTypeValue } from '../../shared/constants/product-offer.constant.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import type { OfferSnapshotType } from './order.model.ts';

export type LockedProduct = {
  id: string;
  status: ProductStatusType;
  transactionNow: Date;
};

export type LockedOffer = {
  id: string;
  type: ProductOfferTypeValue;
  priceAmount: bigint;
  durationDays: number | null;
};

export type LockedProfile = {
  balance: bigint;
};

// The relation is a list in Prisma even though an Order holds exactly one line in the MVP;
// the API field "item" is built from OrderItem[0].
const orderSelect = {
  id: true,
  status: true,
  totalAmount: true,
  paidAt: true,
  createdAt: true,
  OrderItem: {
    select: {
      id: true,
      productId: true,
      productOfferId: true,
      unitPriceAmount: true,
      offerSnapshot: true,
      Product: {
        select: { id: true, name: true, slug: true, status: true },
      },
    },
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

  async lockProduct(productId: string): Promise<LockedProduct | null> {
    const rows = await this.prisma.$queryRaw<
      { id: string; status: ProductStatusType; transactionNowMs: bigint | number | string }[]
    >`
      SELECT id, status, (EXTRACT(EPOCH FROM now()) * 1000)::bigint AS "transactionNowMs"
      FROM "Product"
      WHERE id = ${productId}::uuid
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    const row = rows[0];
    return row
      ? { id: row.id, status: row.status, transactionNow: fromEpochMs(row.transactionNowMs) }
      : null;
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
  async lockCustomerProfile(customerId: string): Promise<LockedProfile | null> {
    const rows = await this.prisma.$queryRaw<{ balance: bigint | number | string }[]>`
      SELECT p.balance
      FROM "Profile" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p."userId" = ${customerId}::uuid
        AND p."deletedAt" IS NULL
        AND u."deletedAt" IS NULL
      FOR UPDATE OF p
    `;
    const row = rows[0];
    return row ? { balance: toBigInt(row.balance) } : null;
  }

  // ---- Writes ----

  // Conditional in the statement itself, so a concurrent top-up or purchase can never
  // drive the balance below zero. Returns the number of rows actually updated.
  async debitBalance({
    customerId,
    amount,
  }: {
    customerId: string;
    amount: bigint;
  }): Promise<number> {
    const result = await this.prisma.profile.updateMany({
      where: { userId: customerId, deletedAt: null, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    return result.count;
  }

  async createOrderWithItem(input: {
    customerId: string;
    idempotencyKey: string;
    paidAt: Date;
    totalAmount: bigint;
    productId: string;
    productOfferId: string;
    unitPriceAmount: bigint;
    offerSnapshot: OfferSnapshotType;
  }): Promise<{ orderId: string; orderItemId: string }> {
    const offerSnapshot: Prisma.InputJsonObject = input.offerSnapshot;
    const order = await this.prisma.order.create({
      data: {
        customerId: input.customerId,
        idempotencyKey: input.idempotencyKey,
        paidAt: input.paidAt,
        totalAmount: input.totalAmount,
        OrderItem: {
          create: {
            productId: input.productId,
            productOfferId: input.productOfferId,
            unitPriceAmount: input.unitPriceAmount,
            offerSnapshot,
          },
        },
      },
      select: { id: true, OrderItem: { select: { id: true } } },
    });
    return { orderId: order.id, orderItemId: order.OrderItem[0]!.id };
  }

  // ---- Reads ----

  // The unique (customerId, idempotencyKey) index answers this in one lookup; the select
  // carries the line's productOfferId so a replay can be told from a reused key.
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
