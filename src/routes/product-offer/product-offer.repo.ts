import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import type { ProductOfferTypeValue } from '../../shared/constants/product-offer.constant.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import type { ProductOfferInputType } from './product-offer.model.ts';

export type LockedProduct = {
  id: string;
  status: ProductStatusType;
  offerChangeTimestamps: Date[];
  transactionNow: Date;
};

export type StoredProductOffer = {
  id: string;
  type: ProductOfferTypeValue;
  priceAmount: bigint;
  durationDays: number | null;
};

@Injectable()
export class ProductOfferRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  // Every mutating path serializes here, so two replacements of one Product can neither
  // create duplicate natural keys nor spend the same rate-limit slot.
  async lockProduct({
    productId,
    publisherAccountId,
  }: {
    productId: string;
    publisherAccountId: string;
  }): Promise<LockedProduct | null> {
    // Epoch milliseconds, not a timestamp: a raw timestamptz would arrive as a Date or a
    // string depending on the driver, while Number() reads either shape of this.
    const rows = await this.prisma.$queryRaw<
      { id: string; status: ProductStatusType; transactionNowMs: bigint | number | string }[]
    >`
      SELECT id, status, (EXTRACT(EPOCH FROM now()) * 1000)::bigint AS "transactionNowMs"
      FROM "Product"
      WHERE id = ${productId}::uuid
        AND "publisherAccountId" = ${publisherAccountId}::uuid
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }

    // The row is locked, so this second read is a primary-key lookup that cannot change
    // underneath us. Going through the typed client keeps the timestamptz[] mapping out
    // of this file.
    const { offerChangeTimestamps } = await this.prisma.product.findUniqueOrThrow({
      where: { id: row.id },
      select: { offerChangeTimestamps: true },
    });

    return {
      id: row.id,
      status: row.status,
      offerChangeTimestamps,
      transactionNow: new Date(Number(row.transactionNowMs)),
    };
  }

  // priceAmount is normalised rather than trusted: a BIGINT that came back as a string
  // would make every diff look like a price change and quietly spend a rate-limit slot.
  async lockOffers(productId: string): Promise<StoredProductOffer[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        type: ProductOfferTypeValue;
        priceAmount: bigint | number | string;
        durationDays: number | string | null;
      }[]
    >`
      SELECT id, type, "priceAmount", "durationDays"
      FROM "ProductOffer"
      WHERE "productId" = ${productId}::uuid
        AND "deletedAt" IS NULL
      ORDER BY id
      FOR UPDATE
    `;

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      priceAmount: BigInt(row.priceAmount),
      durationDays: row.durationDays === null ? null : Number(row.durationDays),
    }));
  }

  // One statement for the whole set: the collection is bounded, but a query per input
  // offer would still serialize round trips under the Product lock.
  async updatePrices({
    updates,
    userId,
  }: {
    updates: { id: string; priceAmount: bigint }[];
    userId: string;
  }): Promise<void> {
    const values = Prisma.join(
      updates.map((update) => Prisma.sql`(${update.id}::uuid, ${update.priceAmount}::bigint)`),
    );
    await this.prisma.$executeRaw`
      UPDATE "ProductOffer" AS offer
      SET "priceAmount" = desired."priceAmount",
          "updatedAt" = now(),
          "updatedById" = ${userId}::uuid
      FROM (VALUES ${values}) AS desired (id, "priceAmount")
      WHERE offer.id = desired.id
    `;
  }

  async insertOffers({
    productId,
    offers,
    userId,
  }: {
    productId: string;
    offers: ProductOfferInputType[];
    userId: string;
  }): Promise<void> {
    await this.prisma.productOffer.createMany({
      data: offers.map((offer) => ({
        productId,
        type: offer.type,
        priceAmount: offer.priceAmount,
        durationDays: offer.durationDays,
        createdById: userId,
      })),
    });
  }

  // Soft deletion is final: a reintroduced type and duration inserts a new row instead.
  async softDeleteOffers({
    offerIds,
    deletedAt,
    userId,
  }: {
    offerIds: string[];
    deletedAt: Date;
    userId: string;
  }): Promise<void> {
    await this.prisma.productOffer.updateMany({
      where: {
        id: { in: offerIds },
        deletedAt: null,
      },
      data: {
        deletedAt,
        deletedById: userId,
      },
    });
  }

  async recordOfferChange({
    productId,
    timestamps,
    userId,
  }: {
    productId: string;
    timestamps: Date[];
    userId: string;
  }): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        offerChangeTimestamps: timestamps,
        updatedAt: timestamps[timestamps.length - 1],
        updatedById: userId,
      },
    });
  }
}
