import { Inject, Injectable } from '@nestjs/common';
import type { ProductStatusType } from '../constants/product.constant.ts';
import { PrismaService } from '../services/prisma.service.ts';

export type LockedProduct = {
  id: string;
  status: ProductStatusType;
  publisherUserId: string;
  publisherActive: boolean;
  transactionNow: Date;
};

// A timestamptz arrives as a Date or a string depending on the driver, so the lock carries
// epoch milliseconds and the conversion happens here.
const fromEpochMs = (value: bigint | number | string) => new Date(Number(value));

/**
 * The one way to take a row lock on a Product.
 *
 * Order and Entitlement both need it and both lock Product first in the shared lock order,
 * so two copies of this query would be two chances for that order to drift apart. What
 * each caller does with the result stays at the call site: a purchase refuses a blocked
 * Publisher because money would move, while an Admin grant deliberately does not.
 */
@Injectable()
export class ProductLockRepository {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  // Joins the caller's transaction when there is one.
  private get prisma() {
    return this.prismaService.getClient();
  }

  // "publisherActive" is carried out rather than filtered in: blocking a Publisher only
  // flips PublisherAccount.status and soft-deletes their role, it never moves their
  // Products off ACTIVE. Filtering here would make a blocked seller indistinguishable
  // from a deleted Product, so the caller decides and logs the difference.
  async lockProduct(productId: string): Promise<LockedProduct | null> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        status: ProductStatusType;
        publisherUserId: string;
        publisherActive: boolean;
        transactionNowMs: bigint | number | string;
      }[]
    >`
      SELECT p.id,
             p.status,
             pa."userId" AS "publisherUserId",
             (pa.status = 'ACTIVE'::"PublisherAccountStatus" AND pa."deletedAt" IS NULL)
               AS "publisherActive",
             (EXTRACT(EPOCH FROM now()) * 1000)::bigint AS "transactionNowMs"
      FROM "Product" p
      JOIN "PublisherAccount" pa ON pa.id = p."publisherAccountId"
      WHERE p.id = ${productId}::uuid
        AND p."deletedAt" IS NULL
      FOR UPDATE OF p
    `;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          status: row.status,
          publisherUserId: row.publisherUserId,
          publisherActive: row.publisherActive,
          transactionNow: fromEpochMs(row.transactionNowMs),
        }
      : null;
  }
}
