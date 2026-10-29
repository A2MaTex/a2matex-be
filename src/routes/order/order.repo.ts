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
}
