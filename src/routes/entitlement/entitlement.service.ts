import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import {
  ENTITLEMENT_GRANT_SNAPSHOT_SCHEMA_VERSION,
  EntitlementGrantSource,
  EntitlementStatus,
} from '../../shared/constants/entitlement.constant.ts';
import type { ProductOfferTypeValue } from '../../shared/constants/product-offer.constant.ts';
import {
  ProductAccessRevokedException,
  ProductAlreadyOwnedException,
} from './entitlement.error.ts';
import { EntitlementRepo } from './entitlement.repo.ts';

export type EntitlementGrantTerms = {
  productOfferId: string;
  durationDays: number | null;
  maxConcurrentDevices: number;
  offerType: ProductOfferTypeValue;
  usagePolicy: Prisma.JsonValue;
};

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  constructor(@Inject(EntitlementRepo) private readonly entitlementRepo: EntitlementRepo) {}

  async assertGrantable({
    customerId,
    productId,
  }: {
    customerId: string;
    productId: string;
  }): Promise<void> {
    const entitlements = await this.entitlementRepo.getByCustomerAndProduct({
      customerId,
      productId,
    });

    if (entitlements.some(({ status }) => status === EntitlementStatus.REVOKED)) {
      this.logger.warn(
        `Entitlement grant rejected: access was revoked customerId=${customerId} productId=${productId}`,
      );
      throw ProductAccessRevokedException;
    }
    // An EXPIRED grant is deliberately not a blocker: re-buying is how a subscription renews.
    if (entitlements.some(({ status }) => status === EntitlementStatus.ACTIVE)) {
      this.logger.warn(
        `Entitlement grant rejected: already owned customerId=${customerId} productId=${productId}`,
      );
      throw ProductAlreadyOwnedException;
    }
  }

  grantFromOrder({
    customerId,
    productId,
    orderItemId,
    terms,
  }: {
    customerId: string;
    productId: string;
    orderItemId: string;
    terms: EntitlementGrantTerms;
  }): Promise<{ id: string }> {
    return this.entitlementRepo.create({
      customerId,
      productId,
      productOfferId: terms.productOfferId,
      orderItemId,
      grantSource: EntitlementGrantSource.ORDER,
      expiresAt: this.resolveExpiry(terms.durationDays),
      maxConcurrentDevices: terms.maxConcurrentDevices,
      grantSnapshot: {
        schemaVersion: ENTITLEMENT_GRANT_SNAPSHOT_SCHEMA_VERSION,
        offerType: terms.offerType,
        usagePolicy: terms.usagePolicy as Prisma.InputJsonValue,
      },
      grantedById: null,
    });
  }

  // Only a SUBSCRIPTION carries a duration; the other types grant indefinitely.
  private resolveExpiry(durationDays: number | null): Date | null {
    if (durationDays === null) {
      return null;
    }
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
    return expiresAt;
  }
}
