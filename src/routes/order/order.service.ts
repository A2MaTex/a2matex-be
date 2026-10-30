import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ORDER_CURRENCY_VND, OrderStatus } from '../../shared/constants/order.constant.ts';
import { ProductOfferStatus } from '../../shared/constants/product-offer.constant.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import { CACHE_PROVIDER } from '../../shared/infrastructure/cache/cache.interface.ts';
import type { CacheProvider } from '../../shared/infrastructure/cache/cache.interface.ts';
import { DistributedLock } from '../../shared/decorators/distributed-lock.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { EntitlementService } from '../entitlement/entitlement.service.ts';
import { ProductAlreadyOwnedException } from '../entitlement/entitlement.error.ts';
import { ProductOfferNotFoundException } from '../product-offer/product-offer.error.ts';
import {
  CannotPurchaseOwnProductException,
  InsufficientBalanceException,
  OrderNotFoundException,
  ProductOfferNotPurchasableException,
} from './order.error.ts';
import type {
  CreateOrderOutputType,
  GetOrderDetailOutputType,
  GetOrderListInputType,
  GetOrderListOutputType,
} from './order.model.ts';
import { OrderRepo } from './order.repo.ts';
import type { PurchasableOfferRow } from './order.repo.ts';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @Inject(OrderRepo) private readonly orderRepo: OrderRepo,
    @Inject(EntitlementService) private readonly entitlementService: EntitlementService,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
    @Inject(CACHE_PROVIDER) private readonly cacheProvider: CacheProvider,
  ) {}

  // Narrow on purpose: locking the whole user would reject a second, unrelated purchase.
  // The conditional debit and the ACTIVE Entitlement index guard the rest.
  @DistributedLock({
    useCase: 'order_checkout',
    resource: ({ userId, offerId }: { userId: string; offerId: string }) => `${userId}:${offerId}`,
  })
  async create({
    offerId,
    userId,
  }: {
    offerId: string;
    userId: string;
  }): Promise<CreateOrderOutputType> {
    const offer = await this.orderRepo.getOffer(offerId);
    if (!offer) {
      this.logger.warn(`Order rejected: Offer not found offerId=${offerId} userId=${userId}`);
      throw ProductOfferNotFoundException;
    }

    // TODO(release): also require the Product to carry a current release that is PUBLISHED
    // and not disabled once the ProductRelease module exists — product.md §8 forbids
    // deciding availability from the Product status alone.
    if (
      offer.status !== ProductOfferStatus.ACTIVE ||
      offer.productStatus !== ProductStatus.ACTIVE
    ) {
      this.logger.warn(
        `Order rejected: Offer is ${offer.status} on a ${offer.productStatus} Product offerId=${offerId}`,
      );
      throw ProductOfferNotPurchasableException;
    }
    if (offer.publisherUserId === userId) {
      this.logger.warn(`Order rejected: Publisher buying its own Product offerId=${offerId}`);
      throw CannotPurchaseOwnProductException;
    }

    await this.entitlementService.assertGrantable({
      customerId: userId,
      productId: offer.productId,
    });

    try {
      return await this.commitCheckout({ offer, userId });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Another checkout for the same Product won the ACTIVE Entitlement index.
      if (isUniqueConstraintPrismaError(error)) {
        this.logger.warn(
          `Order rejected: a concurrent checkout already granted the Entitlement offerId=${offerId}`,
        );
        throw ProductAlreadyOwnedException;
      }
      this.logger.error(
        `Order failed offerId=${offerId} userId=${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  getList({
    query,
    userId,
  }: {
    query: GetOrderListInputType;
    userId: string;
  }): Promise<GetOrderListOutputType> {
    return this.orderRepo.getListByCustomer({ customerId: userId, query });
  }

  async getDetail({
    orderId,
    userId,
  }: {
    orderId: string;
    userId: string;
  }): Promise<GetOrderDetailOutputType> {
    const order = await this.orderRepo.getByIdForCustomer({ orderId, customerId: userId });
    if (!order) {
      this.logger.warn(`Order read rejected: not found or not the caller's orderId=${orderId}`);
      throw OrderNotFoundException;
    }
    return order;
  }

  @Transactional()
  private async commitCheckout({
    offer,
    userId,
  }: {
    offer: PurchasableOfferRow;
    userId: string;
  }): Promise<CreateOrderOutputType> {
    const totalMinor = offer.priceMinor ?? 0n;
    // A FREE Offer names no currency, so the Order falls back to the one v1 sells in.
    const currency = offer.currency ?? ORDER_CURRENCY_VND;
    const paidAt = new Date();

    if (totalMinor > 0n) {
      const debited = await this.orderRepo.debitBalance({ userId, amount: totalMinor });
      if (debited.count === 0) {
        this.logger.warn(
          `Order rejected: balance below ${totalMinor} userId=${userId} offerId=${offer.id}`,
        );
        throw InsufficientBalanceException;
      }
    }

    const order = await this.orderRepo.createPaidOrder({
      customerId: userId,
      offer,
      totalMinor,
      currency,
      paidAt,
    });
    const [item] = order.OrderItem;

    await this.orderRepo.createWalletPayment({
      orderId: order.id,
      amountMinor: totalMinor,
      currency,
    });

    const entitlement = await this.entitlementService.grantFromOrder({
      customerId: userId,
      productId: offer.productId,
      orderItemId: item.id,
      terms: {
        productOfferId: offer.id,
        durationDays: offer.durationDays,
        maxConcurrentDevices: offer.maxConcurrentDevices,
        offerType: offer.type,
        usagePolicy: offer.usagePolicy,
      },
    });

    return {
      id: order.id,
      status: OrderStatus.PAID,
      currency,
      totalMinor,
      paidAt,
      item: {
        id: item.id,
        productId: offer.productId,
        productOfferId: offer.id,
        unitPriceMinor: totalMinor,
        // The CHECK constraint guarantees an object; Prisma's JsonValue is wider.
        offerSnapshot: item.offerSnapshot as CreateOrderOutputType['item']['offerSnapshot'],
      },
      entitlementId: entitlement.id,
    };
  }
}
