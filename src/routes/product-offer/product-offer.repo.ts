import { Inject, Injectable } from '@nestjs/common';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import type {
  CreateProductOfferInputType,
  CreateProductOfferOutputType,
} from './product-offer.model.ts';

@Injectable()
export class ProductOfferRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  // The status is all the service needs to pick the right rejection, so the full
  // management row is not read here.
  getOwnedProduct({
    productId,
    publisherAccountId,
  }: {
    productId: string;
    publisherAccountId: string;
  }): Promise<{ id: string; status: ProductStatusType } | null> {
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        publisherAccountId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  create({
    productId,
    data,
    userId,
  }: {
    productId: string;
    data: CreateProductOfferInputType;
    userId: string;
  }): Promise<CreateProductOfferOutputType> {
    return this.prisma.productOffer.create({
      data: {
        productId,
        type: data.type,
        // A FREE Offer stores 0 rather than NULL so an Order total never has to guess
        // what a missing price means. The request schema already refused a paid Offer
        // without a price, so the fallback below only ever applies to a FREE one.
        priceMinor: BigInt(data.priceMinor ?? 0),
        currency: data.currency ?? null,
        durationDays: data.durationDays ?? null,
        maxConcurrentDevices: data.maxConcurrentDevices,
        usagePolicy: data.usagePolicy,
        createdById: userId,
      },
      select: {
        id: true,
      },
    });
  }
}
