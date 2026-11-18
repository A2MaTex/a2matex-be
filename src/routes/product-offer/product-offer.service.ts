import { Inject, Injectable, Logger } from '@nestjs/common';
import envConfig from '../../shared/config.ts';
import { ProductOfferType } from '../../shared/constants/product-offer.constant.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import type { MessageResType } from '../../shared/models/response.model.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { isTransactionTimeoutPrismaError } from '../../shared/utils/prisma.ts';
import { ProductAccessPolicy } from '../product/product-access.policy.ts';
import { ProductNotFoundException } from '../product/product.error.ts';
import {
  ProductOfferArchivedProductException,
  ProductOfferChangeRateLimitExceededException,
  ProductOfferReplaceTimeoutException,
  ProductOfferSuspendedProductException,
  ProductSubscriptionOfferRequiredException,
} from './product-offer.error.ts';
import { naturalKeyOf } from './product-offer.model.ts';
import type {
  ProductOfferInputType,
  ReplaceProductOffersInputType,
} from './product-offer.model.ts';
import { ProductOfferRepo } from './product-offer.repo.ts';
import type { StoredProductOffer } from './product-offer.repo.ts';

const MILLISECONDS_PER_HOUR = 3_600_000;

type OfferSetDiff = {
  priceUpdates: { id: string; priceAmount: bigint }[];
  inserts: ProductOfferInputType[];
  deletedIds: string[];
};

@Injectable()
export class ProductOfferService {
  private readonly logger = new Logger(ProductOfferService.name);

  constructor(
    @Inject(ProductOfferRepo) private readonly productOfferRepo: ProductOfferRepo,
    @Inject(ProductAccessPolicy) private readonly productAccessPolicy: ProductAccessPolicy,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  async replace(input: {
    productId: string;
    data: ReplaceProductOffersInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<MessageResType> {
    try {
      return await this.replaceInTransaction(input);
    } catch (error) {
      // The loser of a race waits on the Product row lock, so a slow winner shows up
      // here rather than as a conflict. 503 says retrying is the right answer.
      if (isTransactionTimeoutPrismaError(error)) {
        this.logger.error(
          `Product Offer replace timed out waiting for the Product lock productId=${input.productId}`,
        );
        throw ProductOfferReplaceTimeoutException;
      }
      throw error;
    }
  }

  @Transactional()
  private async replaceInTransaction({
    productId,
    data,
    userId,
    scopes,
  }: {
    productId: string;
    data: ReplaceProductOffersInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<MessageResType> {
    const { publisherAccountId } = await this.productAccessPolicy.resolveDraftSaveAccess(
      userId,
      scopes,
    );

    const product = await this.productOfferRepo.lockProduct({ productId, publisherAccountId });
    if (!product) {
      this.logger.warn(
        'Product Offer replace rejected: Product missing or owned by another Publisher ' +
          `productId=${productId} publisherAccountId=${publisherAccountId}`,
      );
      throw ProductNotFoundException;
    }
    if (product.status === ProductStatus.SUSPENDED) {
      this.logger.warn(
        `Product Offer replace rejected: Error.ProductOfferSuspendedProduct productId=${productId}`,
      );
      throw ProductOfferSuspendedProductException;
    }
    if (product.status === ProductStatus.ARCHIVED) {
      this.logger.warn(
        `Product Offer replace rejected: Error.ProductOfferArchivedProduct productId=${productId}`,
      );
      throw ProductOfferArchivedProductException;
    }

    const isPublic = product.status === ProductStatus.ACTIVE;
    // Marketplace list pricing reads subscriptions only, so a public Product that keeps
    // none of them would stay visible without a price.
    if (isPublic && !data.offers.some((offer) => offer.type === ProductOfferType.SUBSCRIPTION)) {
      this.logger.warn(
        `Product Offer replace rejected: active Product keeps no subscription productId=${productId}`,
      );
      throw ProductSubscriptionOfferRequiredException;
    }

    const stored = await this.productOfferRepo.lockOffers(productId);
    const diff = this.diff({ stored, desired: data.offers });
    if (!diff.priceUpdates.length && !diff.inserts.length && !diff.deletedIds.length) {
      return SUCCESS_RESPONSE;
    }

    const retained = isPublic ? this.assertWindowSlot({ product, productId }) : null;

    if (diff.priceUpdates.length) {
      await this.productOfferRepo.updatePrices({ updates: diff.priceUpdates, userId });
    }
    if (diff.inserts.length) {
      await this.productOfferRepo.insertOffers({ productId, offers: diff.inserts, userId });
    }
    if (diff.deletedIds.length) {
      await this.productOfferRepo.softDeleteOffers({
        offerIds: diff.deletedIds,
        deletedAt: product.transactionNow,
        userId,
      });
    }
    if (retained) {
      await this.productOfferRepo.recordOfferChange({
        productId,
        timestamps: [...retained, product.transactionNow],
        userId,
      });
    }

    this.logger.log(
      `Product Offer replace committed productId=${productId} publisherAccountId=${publisherAccountId} ` +
        `status=${product.status} inserted=${diff.inserts.length} updated=${diff.priceUpdates.length} ` +
        `deleted=${diff.deletedIds.length}`,
    );

    return SUCCESS_RESPONSE;
  }

  // Price is not part of the identity: the same type and duration at a new price is an
  // update of that row, never a delete followed by an insert.
  private diff({
    stored,
    desired,
  }: {
    stored: StoredProductOffer[];
    desired: ProductOfferInputType[];
  }): OfferSetDiff {
    const storedByKey = new Map(stored.map((offer) => [naturalKeyOf(offer), offer]));
    const desiredKeys = new Set<string>();
    const priceUpdates: OfferSetDiff['priceUpdates'] = [];
    const inserts: ProductOfferInputType[] = [];

    for (const offer of desired) {
      const key = naturalKeyOf(offer);
      desiredKeys.add(key);

      const current = storedByKey.get(key);
      if (!current) {
        inserts.push(offer);
      } else if (current.priceAmount !== offer.priceAmount) {
        priceUpdates.push({ id: current.id, priceAmount: offer.priceAmount });
      }
    }

    const deletedIds = stored
      .filter((offer) => !desiredKeys.has(naturalKeyOf(offer)))
      .map((offer) => offer.id);

    return { priceUpdates, inserts, deletedIds };
  }

  // Returns the timestamps still inside the window, which the caller stores back with the
  // one it is about to spend.
  private assertWindowSlot({
    product,
    productId,
  }: {
    product: { offerChangeTimestamps: Date[]; transactionNow: Date };
    productId: string;
  }): Date[] {
    const cutoff = new Date(
      product.transactionNow.getTime() -
        envConfig.PRODUCT_OFFER_CHANGE_WINDOW_HOURS * MILLISECONDS_PER_HOUR,
    );
    const retained = product.offerChangeTimestamps.filter((timestamp) => timestamp > cutoff);

    if (retained.length >= envConfig.PRODUCT_OFFER_CHANGE_MAX_COUNT) {
      this.logger.warn(
        `Product Offer replace rejected: change window is full productId=${productId}`,
      );
      throw ProductOfferChangeRateLimitExceededException;
    }

    return retained;
  }
}
