import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { EntitlementStatus } from '../../shared/constants/entitlement.constant.ts';
import { ORDER_OFFER_SNAPSHOT_SCHEMA_VERSION } from '../../shared/constants/order.constant.ts';
import { ProductOfferType } from '../../shared/constants/product-offer.constant.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import {
  isTransactionTimeoutPrismaError,
  isUniqueConstraintPrismaError,
} from '../../shared/utils/prisma.ts';
import { EntitlementService } from '../entitlement/entitlement.service.ts';
import { ProductNotFoundException } from '../product/product.error.ts';
import {
  EntitlementRevokedException,
  EntitlementStillActiveException,
  InsufficientBalanceException,
  OneTimeOfferAlreadyUsedException,
  OrderCustomerProfileNotFoundException,
  OrderIdempotencyKeyReusedException,
  OrderNotFoundException,
  OrderOperationTimeoutException,
  ProductNotPurchasableException,
  ProductOfferNotFoundException,
} from './order.error.ts';
import type {
  CreateOrderInputType,
  CreateOrderOutputType,
  GetMyOrdersInputType,
  GetMyOrdersOutputType,
  OfferSnapshotType,
  OrderOutputType,
} from './order.model.ts';
import { OrderRepo } from './order.repo.ts';
import type { OrderRow } from './order.repo.ts';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @Inject(OrderRepo) private readonly orderRepo: OrderRepo,
    @Inject(EntitlementService) private readonly entitlementService: EntitlementService,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  // ---- Buy (US1, US2) ----

  async create(input: {
    data: CreateOrderInputType;
    idempotencyKey: string;
    customerId: string;
  }): Promise<CreateOrderOutputType> {
    const { data, idempotencyKey, customerId } = input;

    // Checked before any lock so a replayed key never reaches the balance.
    const claimed = await this.orderRepo.findByIdempotencyKey({ customerId, idempotencyKey });
    if (claimed) {
      return this.resolveReplay(claimed, data.productOfferId, customerId);
    }

    try {
      return await this.createInTransaction(input);
    } catch (error) {
      // A concurrent request carrying this key commits the Order this one was told did not
      // exist yet, and the loser rarely fails on the key itself: it usually trips a
      // business rule first, or times out on a lock the winner holds. An Order for this
      // key means the documented idempotent answer, not the failure this attempt hit.
      const concurrent = await this.orderRepo.findByIdempotencyKey({
        customerId,
        idempotencyKey,
      });
      if (concurrent) {
        return this.resolveReplay(concurrent, data.productOfferId, customerId);
      }

      if (error instanceof HttpException) {
        throw error;
      }
      if (isTransactionTimeoutPrismaError(error)) {
        this.logger.error(
          `Order create timed out waiting for a row lock customerId=${customerId} ` +
            `productOfferId=${data.productOfferId}`,
        );
        throw OrderOperationTimeoutException;
      }
      if (isUniqueConstraintPrismaError(error)) {
        // The probe above already looked for the row this key would have, so reaching here
        // means the constraint fired for something else entirely.
        this.logger.error(
          `Order create hit a unique constraint with no Order to replay customerId=${customerId}`,
        );
      }
      throw error;
    }
  }

  // Everything a purchase touches lives in this one transaction: the balance, the Order
  // and the Entitlement either all commit or none do (FR-002).
  @Transactional()
  private async createInTransaction({
    data,
    idempotencyKey,
    customerId,
  }: {
    data: CreateOrderInputType;
    idempotencyKey: string;
    customerId: string;
  }): Promise<CreateOrderOutputType> {
    const { productOfferId } = data;

    // Locks run Product -> ProductOffer -> Profile -> Entitlement, the order every other
    // module uses, so these transactions queue instead of deadlocking.
    const productId = await this.orderRepo.findOfferProductId(productOfferId);
    if (!productId) {
      throw ProductOfferNotFoundException;
    }

    const product = await this.orderRepo.lockProduct(productId);
    if (!product) {
      throw ProductNotFoundException;
    }
    if (product.status !== ProductStatus.ACTIVE) {
      this.logger.warn(
        `Order rejected: Error.ProductNotPurchasable productId=${productId} status=${product.status}`,
      );
      throw ProductNotPurchasableException;
    }

    // Re-read under lock: the publisher may have replaced the price list in between.
    const offer = await this.orderRepo.lockOfferForUpdate(productOfferId, productId);
    if (!offer) {
      throw ProductOfferNotFoundException;
    }

    const profile = await this.orderRepo.lockCustomerProfile(customerId);
    if (!profile) {
      throw OrderCustomerProfileNotFoundException;
    }

    // The Profile lock serializes this customer's purchases, so a request that lost the
    // race now sees the winner's Order instead of running a doomed transaction.
    const concurrent = await this.orderRepo.findByIdempotencyKey({ customerId, idempotencyKey });
    if (concurrent) {
      return this.resolveReplay(concurrent, productOfferId, customerId);
    }

    const now = product.transactionNow;
    const entitlement = await this.entitlementService.lockForPurchase({ customerId, productId });
    if (entitlement) {
      // Revoked first: activating a revoked Entitlement would break its own check
      // constraint and fail the purchase with a 500 instead of a reason (FR-010).
      if (entitlement.status === EntitlementStatus.REVOKED) {
        throw EntitlementRevokedException;
      }
      if (entitlement.expiresAt === null || entitlement.expiresAt.getTime() > now.getTime()) {
        throw EntitlementStillActiveException;
      }
      // One free or introductory offer per customer and Product, however many ONE_TIME
      // offers the publisher lists (FR-011).
      if (
        offer.type === ProductOfferType.ONE_TIME &&
        entitlement.oneTimePurchasedAt !== null
      ) {
        throw OneTimeOfferAlreadyUsedException;
      }
    }

    if (profile.balance < offer.priceAmount) {
      throw InsufficientBalanceException;
    }

    // The Profile row is already locked and the balance already compared, so a guard that
    // still matches no row means the invariant is broken, not that the customer is short.
    const debited = await this.orderRepo.debitBalance({
      customerId,
      amount: offer.priceAmount,
    });
    if (debited === 0) {
      this.logger.error(
        `Order debit matched no Profile row customerId=${customerId} amount=${offer.priceAmount}`,
      );
      throw new Error('Order balance debit affected no row');
    }

    const offerSnapshot: OfferSnapshotType = {
      schemaVersion: ORDER_OFFER_SNAPSHOT_SCHEMA_VERSION,
      offerType: offer.type,
      priceAmount: offer.priceAmount.toString(),
      durationDays: offer.durationDays,
    };

    const orderId = await this.orderRepo.createOrder({
      customerId,
      idempotencyKey,
      paidAt: now,
      totalAmount: offer.priceAmount,
      productId,
      productOfferId,
      offerSnapshot,
    });

    await this.entitlementService.activateFromOrder({
      customerId,
      productId,
      orderId,
      productOfferId,
      offerType: offer.type,
      durationDays: offer.durationDays,
      now,
    });

    this.logger.log(
      `Order created orderId=${orderId} customerId=${customerId} productId=${productId} ` +
        `productOfferId=${productOfferId} totalAmount=${offer.priceAmount}`,
    );

    const row = await this.orderRepo.findOrderForCustomer({ orderId, customerId });
    if (!row) {
      this.logger.error(`Order disappeared right after it was written orderId=${orderId}`);
      throw new Error('Order not readable after write');
    }
    return this.withEntitlement(row, customerId);
  }

  // ---- Purchase history (US4) ----

  async listMine({
    customerId,
    query,
  }: {
    customerId: string;
    query: GetMyOrdersInputType;
  }): Promise<GetMyOrdersOutputType> {
    const { page, pageSize, skip, take } = getPagination(query);
    const { rows, totalItems } = await this.orderRepo.listMine({ customerId, skip, take });

    return {
      items: rows.map((row) => this.toOrderOutput(row)),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  // An Order of another customer answers the same way as one that never existed, so the
  // reply never reveals that someone else's Order has this id (FR-031).
  async findOne({
    orderId,
    customerId,
  }: {
    orderId: string;
    customerId: string;
  }): Promise<OrderOutputType> {
    const row = await this.orderRepo.findOrderForCustomer({ orderId, customerId });
    if (!row) {
      throw OrderNotFoundException;
    }
    return this.toOrderOutput(row);
  }

  // ---- Helpers ----

  // Same answer as the original purchase, or a refusal when the key was reused for a
  // different offer (FR-022).
  private async resolveReplay(
    order: OrderRow,
    productOfferId: string,
    customerId: string,
  ): Promise<CreateOrderOutputType> {
    if (order.productOfferId !== productOfferId) {
      this.logger.warn(`Idempotency key reused with a different offer orderId=${order.id}`);
      throw OrderIdempotencyKeyReusedException;
    }
    return this.withEntitlement(order, customerId);
  }

  // The entitlement block is read live, so a replay shows the access as it stands now
  // rather than as it stood when the Order was paid.
  private async withEntitlement(
    row: OrderRow,
    customerId: string,
  ): Promise<CreateOrderOutputType> {
    const productId = row.productId;
    const entitlement = await this.entitlementService.findSummaryForOrder({
      customerId,
      productId,
    });
    if (!entitlement) {
      this.logger.error(
        `Order has no Entitlement orderId=${row.id} customerId=${customerId} productId=${productId}`,
      );
      throw new Error('Order without an Entitlement');
    }

    return { ...this.toOrderOutput(row), entitlement };
  }

  // The purchase lives on the Order row itself; "item" is kept in the response because the
  // clients read it. "item.id" is the Order's own id and "unitPriceAmount" its total: one
  // Product per Order means nothing else they could hold.
  private toOrderOutput(row: OrderRow): OrderOutputType {
    return {
      id: row.id,
      status: row.status,
      totalAmount: row.totalAmount,
      paidAt: row.paidAt,
      createdAt: row.createdAt,
      item: {
        id: row.id,
        productId: row.productId,
        productOfferId: row.productOfferId,
        unitPriceAmount: row.totalAmount,
        offerSnapshot: row.offerSnapshot,
        product: row.Product,
      },
    };
  }
}
