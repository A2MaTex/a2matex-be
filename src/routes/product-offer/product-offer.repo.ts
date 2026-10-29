import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { buildProductAccessWhere, type ProductAccess } from '../product/product-access.model.ts';
import type {
  CreateProductOfferInputType,
  CreateProductOfferOutputType,
  GetProductOfferListInputType,
  GetProductOfferListOutputType,
  ProductOfferManagementOutputType,
} from './product-offer.model.ts';

const PRODUCT_OFFER_SELECT = {
  id: true,
  productId: true,
  type: true,
  status: true,
  priceMinor: true,
  currency: true,
  durationDays: true,
  maxConcurrentDevices: true,
  usagePolicy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductOfferSelect;

@Injectable()
export class ProductOfferRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  // The status is all the service needs to pick the right rejection, so the full
  // management row is not read here.
  getProduct({
    productId,
    access,
  }: {
    productId: string;
    access: ProductAccess;
  }): Promise<{ id: string; status: ProductStatusType } | null> {
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        ...buildProductAccessWhere(access),
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  async getListByProduct({
    productId,
    query,
  }: {
    productId: string;
    query: GetProductOfferListInputType;
  }): Promise<GetProductOfferListOutputType> {
    const { page, limit, skip, take } = getPagination(query);
    const where = { productId, deletedAt: null };

    const [totalItems, offers] = await Promise.all([
      this.prisma.productOffer.count({ where }),
      this.prisma.productOffer.findMany({
        where,
        select: PRODUCT_OFFER_SELECT,
        // Newest first, with the id as a tie-breaker so two Offers created in the same
        // millisecond keep a stable order across pages.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);

    return {
      // `ProductOffer_usagePolicy_object_check` guarantees every stored policy is a
      // JSON object, which Prisma's wider JsonValue type cannot express.
      items: offers as ProductOfferManagementOutputType[],
      totalItems,
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
    };
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
