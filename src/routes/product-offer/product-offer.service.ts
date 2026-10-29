import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ProductOfferLifecycleAction,
  ProductOfferStatus,
  ProductOfferType,
} from '../../shared/constants/product-offer.constant.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import type { MessageResType } from '../../shared/models/response.model.ts';
import { ProductAccessPolicy } from '../product/product-access.policy.ts';
import { ProductArchivedException, ProductNotFoundException } from '../product/product.error.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import {
  ProductOfferAlreadyActiveException,
  ProductOfferCannotBeActivatedException,
  ProductOfferCannotBeDeactivatedException,
  ProductOfferNotEditableException,
  ProductOfferNotFoundException,
  productOfferShapeException,
} from './product-offer.error.ts';
import { ProductOfferCommercialShape } from './product-offer.model.ts';
import type {
  CreateProductOfferInputType,
  CreateProductOfferOutputType,
  GetProductOfferListInputType,
  GetProductOfferListOutputType,
  UpdateProductOfferInputType,
  UpdateProductOfferLifecycleInputType,
} from './product-offer.model.ts';
import { ProductOfferRepo } from './product-offer.repo.ts';
import type { ProductOfferCommercialRow } from './product-offer.repo.ts';

@Injectable()
export class ProductOfferService {
  private readonly logger = new Logger(ProductOfferService.name);

  constructor(
    @Inject(ProductOfferRepo) private readonly productOfferRepo: ProductOfferRepo,
    @Inject(ProductAccessPolicy) private readonly productAccessPolicy: ProductAccessPolicy,
  ) {}

  async create({
    productId,
    data,
    userId,
    scopes,
  }: {
    productId: string;
    data: CreateProductOfferInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<CreateProductOfferOutputType> {
    const { publisherAccountId } = await this.productAccessPolicy.resolveDraftSaveAccess(
      userId,
      scopes,
    );

    // Writes are pinned to the caller's own Publisher account.
    const product = await this.productOfferRepo.getProduct({
      productId,
      access: { unrestricted: false, publisherAccountId },
    });
    if (!product) {
      this.logger.warn(
        'Product Offer create rejected: Product missing or owned by another Publisher ' +
          `productId=${productId} publisherAccountId=${publisherAccountId}`,
      );
      throw ProductNotFoundException;
    }
    // A suspended Product may still gather Offers; only activation puts one on sale.
    if (product.status === ProductStatus.ARCHIVED) {
      this.logger.warn(`Product Offer create rejected: Product archived productId=${productId}`);
      throw ProductArchivedException;
    }

    try {
      return await this.productOfferRepo.create({ productId, data, userId });
    } catch (error) {
      // CatchEverythingFilter answers 500 without logging anything itself.
      this.logger.error(
        `Product Offer create failed productId=${productId} type=${data.type}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async update({
    productId,
    offerId,
    data,
    userId,
    scopes,
  }: {
    productId: string;
    offerId: string;
    data: UpdateProductOfferInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<MessageResType> {
    const { publisherAccountId } = await this.productAccessPolicy.resolveDraftSaveAccess(
      userId,
      scopes,
    );

    const offer = await this.productOfferRepo.getOwnedOffer({
      offerId,
      productId,
      publisherAccountId,
    });
    if (!offer) {
      this.logger.warn(
        'Product Offer update rejected: Offer missing or owned by another Publisher ' +
          `offerId=${offerId} productId=${productId} publisherAccountId=${publisherAccountId}`,
      );
      throw ProductOfferNotFoundException;
    }
    // An ACTIVE Offer is what customers are being sold right now.
    if (offer.status === ProductOfferStatus.ACTIVE) {
      this.logger.warn(`Product Offer update rejected: Offer is ACTIVE offerId=${offerId}`);
      throw ProductOfferNotEditableException;
    }

    this.assertMergedShape({ offer, data, offerId });

    const result = await this.productOfferRepo.updateEditable({
      offerId,
      productId,
      publisherAccountId,
      data,
      userId,
    });
    if (result.count === 0) {
      // It matched a moment ago, so only a concurrent ACTIVATE or delete explains this.
      this.logger.warn(
        `Product Offer update rejected: Offer changed during the update offerId=${offerId}`,
      );
      throw ProductOfferNotEditableException;
    }

    return SUCCESS_RESPONSE;
  }

  async getList({
    productId,
    query,
    userId,
    scopes,
  }: {
    productId: string;
    query: GetProductOfferListInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<GetProductOfferListOutputType> {
    const access = await this.productAccessPolicy.resolveReadAccess(userId, scopes);
    if (!access) {
      this.logger.warn(
        `Product Offer read rejected: caller owns no Publisher account productId=${productId} userId=${userId}`,
      );
      throw ProductNotFoundException;
    }

    // Ownership first: a Product the caller cannot see must stay invisible.
    const product = await this.productOfferRepo.getProduct({ productId, access });
    if (!product) {
      this.logger.warn(
        `Product Offer read rejected: Product not found or not visible productId=${productId} userId=${userId}`,
      );
      throw ProductNotFoundException;
    }

    return this.productOfferRepo.getListByProduct({ productId, query });
  }

  async applyLifecycle({
    productId,
    offerId,
    data,
    userId,
    scopes,
  }: {
    productId: string;
    offerId: string;
    data: UpdateProductOfferLifecycleInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<MessageResType> {
    const { publisherAccountId } = await this.productAccessPolicy.resolveDraftSaveAccess(
      userId,
      scopes,
    );

    const offer = await this.productOfferRepo.getOwnedOffer({
      offerId,
      productId,
      publisherAccountId,
    });
    if (!offer) {
      this.logger.warn(
        'Product Offer lifecycle rejected: Offer missing or owned by another Publisher ' +
          `offerId=${offerId} productId=${productId} publisherAccountId=${publisherAccountId}`,
      );
      throw ProductOfferNotFoundException;
    }

    if (data.action === ProductOfferLifecycleAction.ACTIVATE) {
      await this.activate({ offer, offerId, productId, publisherAccountId, userId });
    } else {
      await this.deactivate({ offer, offerId, productId, publisherAccountId, userId });
    }

    return SUCCESS_RESPONSE;
  }

  private async activate({
    offer,
    offerId,
    productId,
    publisherAccountId,
    userId,
  }: {
    offer: ProductOfferCommercialRow;
    offerId: string;
    productId: string;
    publisherAccountId: string;
    userId: string;
  }): Promise<void> {
    if (offer.status === ProductOfferStatus.ACTIVE) {
      return;
    }
    // TODO(release): also require a current release that is PUBLISHED and not disabled
    // once the ProductRelease module exists — product.md §8 forbids deciding availability
    // from the Product status alone.
    if (offer.productStatus !== ProductStatus.ACTIVE) {
      this.logger.warn(
        `Product Offer activate rejected: Product is ${offer.productStatus} offerId=${offerId}`,
      );
      throw ProductOfferCannotBeActivatedException;
    }

    let result: { count: number };
    try {
      result = await this.productOfferRepo.activate({
        offerId,
        productId,
        publisherAccountId,
        userId,
      });
    } catch (error) {
      // The partial unique index allows one ACTIVE Offer per Product.
      if (isUniqueConstraintPrismaError(error)) {
        this.logger.warn(
          `Product Offer activate rejected: Product already sells another Offer offerId=${offerId}`,
        );
        throw ProductOfferAlreadyActiveException;
      }
      this.logger.error(
        `Product Offer activate failed offerId=${offerId} productId=${productId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }

    if (result.count === 0) {
      this.logger.warn(
        `Product Offer activate rejected: Offer or Product changed during the action offerId=${offerId}`,
      );
      throw ProductOfferCannotBeActivatedException;
    }
  }

  private async deactivate({
    offer,
    offerId,
    productId,
    publisherAccountId,
    userId,
  }: {
    offer: ProductOfferCommercialRow;
    offerId: string;
    productId: string;
    publisherAccountId: string;
    userId: string;
  }): Promise<void> {
    if (offer.status === ProductOfferStatus.INACTIVE) {
      return;
    }
    // A DRAFT Offer was never on sale, so there is nothing to take off sale.
    if (offer.status !== ProductOfferStatus.ACTIVE) {
      this.logger.warn(
        `Product Offer deactivate rejected: Offer is ${offer.status} offerId=${offerId}`,
      );
      throw ProductOfferCannotBeDeactivatedException;
    }

    const result = await this.productOfferRepo.deactivate({
      offerId,
      productId,
      publisherAccountId,
      userId,
    });
    if (result.count === 0) {
      this.logger.warn(
        `Product Offer deactivate rejected: Offer changed during the action offerId=${offerId}`,
      );
      throw ProductOfferCannotBeDeactivatedException;
    }
  }

  // Whether a price or duration is legal depends on the stored `type`, not on the body.
  private assertMergedShape({
    offer,
    data,
    offerId,
  }: {
    offer: ProductOfferCommercialRow;
    data: UpdateProductOfferInputType;
    offerId: string;
  }): void {
    // A FREE Offer stores 0, while the shared rules expect no price at all.
    const storedPriceMinor =
      offer.type === ProductOfferType.FREE || offer.priceMinor === null
        ? null
        : Number(offer.priceMinor);

    const merged = {
      type: offer.type,
      priceMinor: data.priceMinor === undefined ? storedPriceMinor : data.priceMinor,
      currency: data.currency === undefined ? offer.currency : data.currency,
      durationDays: data.durationDays === undefined ? offer.durationDays : data.durationDays,
    };

    const result = ProductOfferCommercialShape.safeParse(merged);
    if (result.success) {
      return;
    }

    const issues = result.error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.join('.'),
    }));
    this.logger.warn(
      `Product Offer update rejected: patch breaks the ${offer.type} shape offerId=${offerId} ` +
        `fields=${issues.map((issue) => issue.path).join(',')}`,
    );
    throw productOfferShapeException(issues);
  }
}
