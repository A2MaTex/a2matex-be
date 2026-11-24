import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';

const earningSelect = {
  id: true,
  productId: true,
  totalAmount: true,
  commissionAmount: true,
  publisherAmount: true,
  commissionRateBps: true,
  paidAt: true,
  Product: { select: { name: true } },
} satisfies Prisma.OrderSelect;

export type EarningRow = Prisma.OrderGetPayload<{ select: typeof earningSelect }>;

@Injectable()
export class PublisherEarningRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  // publisherUserId is the only filter, and it comes from the authenticated caller. No
  // parameter reaches this method that could widen the scope.
  async list(input: {
    publisherUserId: string;
    skip: number;
    take: number;
  }): Promise<{ rows: EarningRow[]; totalItems: number }> {
    const where = { publisherUserId: input.publisherUserId };
    const [totalItems, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: earningSelect,
        // Follows ("publisherUserId", "createdAt" DESC); id breaks ties so paging is
        // stable when two sales share a timestamp.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: input.skip,
        take: input.take,
      }),
    ]);
    return { rows, totalItems };
  }

  async summarise(publisherUserId: string): Promise<{
    orderCount: number;
    grossAmount: bigint;
    commissionAmount: bigint;
    netAmount: bigint;
  }> {
    const result = await this.prisma.order.aggregate({
      where: { publisherUserId },
      _count: { _all: true },
      _sum: { totalAmount: true, commissionAmount: true, publisherAmount: true },
    });
    return {
      orderCount: result._count._all,
      grossAmount: result._sum.totalAmount ?? 0n,
      commissionAmount: result._sum.commissionAmount ?? 0n,
      netAmount: result._sum.publisherAmount ?? 0n,
    };
  }
}
