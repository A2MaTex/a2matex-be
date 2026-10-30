import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { buildProductAccessWhere, type ProductAccess } from '../product/product-access.model.ts';
import { ProductOfferStatus } from '../../shared/constants/product-offer.constant.ts';
import type { ProductOfferStatusValue } from '../../shared/constants/product-offer.constant.ts';
import type { ProductOfferTypeValue } from '../../shared/constants/product-offer.constant.ts';
import type {
  CreateProductOfferInputType,
  CreateProductOfferOutputType,
  GetProductOfferListInputType,
  GetProductOfferListOutputType,
  ProductOfferManagementOutputType,
  UpdateProductOfferInputType,
} from './product-offer.model.ts';

/** The columns an update or a lifecycle action has to judge the Offer by. */
export type ProductOfferCommercialRow = {
  id: string;
  status: ProductOfferStatusValue;
  productStatus: ProductStatusType;
  type: ProductOfferTypeValue;
  priceMinor: bigint | null;
  currency: string | null;
  durationDays: number | null;
};

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
        // The id breaks ties so pages stay stable.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);

    return {
      // The usagePolicy CHECK guarantees an object; Prisma's JsonValue is wider.
      items: offers as ProductOfferManagementOutputType[],
      totalItems,
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  // An Offer is the caller's only if its Product is.
  async getOwnedOffer({
    offerId,
    productId,
    publisherAccountId,
  }: {
    offerId: string;
    productId: string;
    publisherAccountId: string;
  }): Promise<ProductOfferCommercialRow | null> {
    const offer = await this.prisma.productOffer.findFirst({
      where: {
        id: offerId,
        productId,
        deletedAt: null,
        Product: {
          publisherAccountId,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        status: true,
        type: true,
        priceMinor: true,
        currency: true,
        durationDays: true,
        Product: {
          select: {
            status: true,
          },
        },
      },
    });

    return offer && { ...offer, productStatus: offer.Product.status };
  }

  // TODO(release): once ProductRelease exists, this must also require the Product to
  // carry a current release that is PUBLISHED and not disabled (product.md §8).
  activate({
    offerId,
    productId,
    publisherAccountId,
    userId,
  }: {
    offerId: string;
    productId: string;
    publisherAccountId: string;
    userId: string;
  }): Promise<{ count: number }> {
    return this.prisma.productOffer.updateMany({
      where: {
        id: offerId,
        productId,
        deletedAt: null,
        status: {
          in: [ProductOfferStatus.DRAFT, ProductOfferStatus.INACTIVE],
        },
        Product: {
          publisherAccountId,
          deletedAt: null,
          status: ProductStatus.ACTIVE,
        },
      },
      data: {
        status: ProductOfferStatus.ACTIVE,
        updatedById: userId,
        updatedAt: new Date(),
      },
    });
  }

  deactivate({
    offerId,
    productId,
    publisherAccountId,
    userId,
  }: {
    offerId: string;
    productId: string;
    publisherAccountId: string;
    userId: string;
  }): Promise<{ count: number }> {
    return this.prisma.productOffer.updateMany({
      where: {
        id: offerId,
        productId,
        deletedAt: null,
        status: ProductOfferStatus.ACTIVE,
        Product: {
          publisherAccountId,
          deletedAt: null,
        },
      },
      data: {
        status: ProductOfferStatus.INACTIVE,
        updatedById: userId,
        updatedAt: new Date(),
      },
    });
  }

  // The status guard repeats here: a concurrent ACTIVATE must not lose its price.
  updateEditable({
    offerId,
    productId,
    publisherAccountId,
    data,
    userId,
  }: {
    offerId: string;
    productId: string;
    publisherAccountId: string;
    data: UpdateProductOfferInputType;
    userId: string;
  }): Promise<{ count: number }> {
    const { priceMinor, ...fields } = data;

    return this.prisma.productOffer.updateMany({
      where: {
        id: offerId,
        productId,
        deletedAt: null,
        status: {
          in: [ProductOfferStatus.DRAFT, ProductOfferStatus.INACTIVE],
        },
        Product: {
          publisherAccountId,
          deletedAt: null,
        },
      },
      data: {
        ...fields,
        ...(priceMinor === undefined ? {} : { priceMinor: BigInt(priceMinor ?? 0) }),
        updatedById: userId,
        updatedAt: new Date(),
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
        // A FREE Offer stores 0, not NULL, so Order totals never have to guess.
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
