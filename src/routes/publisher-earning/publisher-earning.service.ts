import { Inject, Injectable } from '@nestjs/common';
import { getPagination } from '../../shared/utils/pagination.ts';
import type {
  GetPublisherEarningsInputType,
  GetPublisherEarningsOutputType,
  PublisherEarningSummaryOutputType,
} from './publisher-earning.model.ts';
import { PublisherEarningRepo } from './publisher-earning.repo.ts';

@Injectable()
export class PublisherEarningService {
  constructor(
    @Inject(PublisherEarningRepo) private readonly repo: PublisherEarningRepo,
  ) {}

  // publisherUserId always comes from the access token, never from the request, which is
  // what keeps one Publisher out of another's figures.
  async listMine(input: {
    publisherUserId: string;
    query: GetPublisherEarningsInputType;
  }): Promise<GetPublisherEarningsOutputType> {
    const { page, pageSize, skip, take } = getPagination(input.query);
    const { rows, totalItems } = await this.repo.list({
      publisherUserId: input.publisherUserId,
      skip,
      take,
    });

    return {
      items: rows.map((row) => ({
        orderId: row.id,
        productId: row.productId,
        productName: row.Product.name,
        totalAmount: row.totalAmount,
        commissionAmount: row.commissionAmount,
        publisherAmount: row.publisherAmount,
        commissionRateBps: row.commissionRateBps,
        paidAt: row.paidAt,
      })),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  // Someone who has never sold anything gets zeroes, not an error: not being a seller is
  // a normal state, not a failure.
  summariseMine(publisherUserId: string): Promise<PublisherEarningSummaryOutputType> {
    return this.repo.summarise(publisherUserId);
  }
}
