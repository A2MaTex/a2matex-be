import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ProductOfferStatus,
  ProductOfferType,
} from '../../shared/constants/product-offer.constant.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import type { MessageResType } from '../../shared/models/response.model.ts';
import { ProductAccessPolicy } from '../product/product-access.policy.ts';
import { ProductArchivedException, ProductNotFoundException } from '../product/product.error.ts';
import {
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
}
