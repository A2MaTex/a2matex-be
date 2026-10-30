import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import {
  ORDER_SNAPSHOT_SCHEMA_VERSION,
  OrderStatus,
  PAYMENT_PROVIDER_WALLET,
  PaymentStatus,
} from '../../shared/constants/order.constant.ts';
import type { ProductOfferStatusValue } from '../../shared/constants/product-offer.constant.ts';
import type { ProductOfferTypeValue } from '../../shared/constants/product-offer.constant.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type {
  GetOrderDetailOutputType,
  GetOrderListInputType,
  GetOrderListOutputType,
  OrderOutputType,
} from './order.model.ts';

export type PurchasableOfferRow = {
  id: string;
  productId: string;
  type: ProductOfferTypeValue;
  status: ProductOfferStatusValue;
  priceMinor: bigint | null;
  currency: string | null;
  durationDays: number | null;
  maxConcurrentDevices: number;
  usagePolicy: Prisma.JsonValue;
  productStatus: ProductStatusType;
  publisherUserId: string;
};

const ORDER_SELECT = {
  id: true,
  status: true,
  currency: true,
  totalMinor: true,
  paidAt: true,
  createdAt: true,
  OrderItem: {
    select: {
      id: true,
      productId: true,
      productOfferId: true,
      unitPriceMinor: true,
      offerSnapshot: true,
      Product: {
        select: { name: true, slug: true },
      },
    },
  },
} satisfies Prisma.OrderSelect;

const ORDER_DETAIL_SELECT = {
  ...ORDER_SELECT,
  OrderItem: {
    select: {
      ...ORDER_SELECT.OrderItem.select,
      Entitlement: { select: { id: true } },
    },
  },
  PaymentTransaction: {
    select: {
      id: true,
      provider: true,
      status: true,
      currency: true,
      amountMinor: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;
type OrderDetailRow = Prisma.OrderGetPayload<{ select: typeof ORDER_DETAIL_SELECT }>;

@Injectable()
export class OrderRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  async getOffer(offerId: string): Promise<PurchasableOfferRow | null> {
    const offer = await this.prisma.productOffer.findFirst({
      where: { id: offerId, deletedAt: null },
      select: {
        id: true,
        productId: true,
        type: true,
        status: true,
        priceMinor: true,
        currency: true,
        durationDays: true,
        maxConcurrentDevices: true,
        usagePolicy: true,
        Product: {
          select: {
            status: true,
            deletedAt: true,
            PublisherAccount: {
              select: { userId: true },
            },
          },
        },
      },
    });

    if (!offer || offer.Product.deletedAt) {
      return null;
    }

    return {
      ...offer,
      productStatus: offer.Product.status,
      publisherUserId: offer.Product.PublisherAccount.userId,
    };
  }

  async getListByCustomer({
    customerId,
    query,
  }: {
    customerId: string;
    query: GetOrderListInputType;
  }): Promise<GetOrderListOutputType> {
    const { page, limit, skip, take } = getPagination(query);
    const where = { customerId, status: query.status };

    const [totalItems, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: ORDER_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);

    return {
      items: orders.map((order) => this.toOutput(order)),
      totalItems,
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  async getByIdForCustomer({
    orderId,
    customerId,
  }: {
    orderId: string;
    customerId: string;
  }): Promise<GetOrderDetailOutputType | null> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: ORDER_DETAIL_SELECT,
    });
    return order && this.toDetailOutput(order);
  }

  // Conditional on purpose: a balance that cannot cover the order matches no row, so it
  // can never go negative under concurrent checkouts.
  debitBalance({ userId, amount }: { userId: string; amount: bigint }): Promise<{ count: number }> {
    return this.prisma.profile.updateMany({
      where: {
        userId,
        deletedAt: null,
        balance: { gte: amount },
      },
      data: {
        balance: { decrement: amount },
      },
    });
  }

  createPaidOrder({
    customerId,
    offer,
    totalMinor,
    currency,
    paidAt,
  }: {
    customerId: string;
    offer: PurchasableOfferRow;
    totalMinor: bigint;
    currency: string;
    paidAt: Date;
  }): Promise<{ id: string; OrderItem: { id: string; offerSnapshot: Prisma.JsonValue }[] }> {
    return this.prisma.order.create({
      data: {
        customerId,
        status: OrderStatus.PAID,
        currency,
        totalMinor,
        paidAt,
        OrderItem: {
          create: {
            productId: offer.productId,
            productOfferId: offer.id,
            unitPriceMinor: totalMinor,
            offerSnapshot: {
              schemaVersion: ORDER_SNAPSHOT_SCHEMA_VERSION,
              offerType: offer.type,
              currency,
              priceMinor: Number(totalMinor),
              durationDays: offer.durationDays,
              maxConcurrentDevices: offer.maxConcurrentDevices,
            },
          },
        },
      },
      select: {
        id: true,
        OrderItem: { select: { id: true, offerSnapshot: true } },
      },
    });
  }

  // providerTransactionId is the order id, so the unique index refuses a second charge.
  createWalletPayment({
    orderId,
    amountMinor,
    currency,
  }: {
    orderId: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<{ id: string }> {
    return this.prisma.paymentTransaction.create({
      data: {
        orderId,
        provider: PAYMENT_PROVIDER_WALLET,
        providerTransactionId: orderId,
        status: PaymentStatus.SUCCEEDED,
        currency,
        amountMinor,
        providerResult: {
          schemaVersion: ORDER_SNAPSHOT_SCHEMA_VERSION,
          settledFrom: PAYMENT_PROVIDER_WALLET,
        },
      },
      select: { id: true },
    });
  }

  // v1 writes exactly one item per Order, so the single item is the Order's line.
  private toOutput({ OrderItem: [item], ...order }: OrderRow): OrderOutputType {
    const { Product, ...line } = item;
    return {
      ...order,
      item: {
        ...line,
        // The CHECK constraint guarantees an object; Prisma's JsonValue is wider.
        offerSnapshot: line.offerSnapshot as OrderOutputType['item']['offerSnapshot'],
        product: Product,
      },
    };
  }

  private toDetailOutput({
    PaymentTransaction: [payment],
    ...order
  }: OrderDetailRow): GetOrderDetailOutputType {
    const [
      {
        Entitlement: [entitlement],
      },
    ] = order.OrderItem;
    return {
      ...this.toOutput(order),
      payment: payment ?? null,
      entitlementId: entitlement?.id ?? null,
    };
  }
}
