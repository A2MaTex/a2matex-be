import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import type {
  EntitlementGrantSourceValue,
  EntitlementStatusValue,
} from '../../shared/constants/entitlement.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';

export type EntitlementGrantInput = {
  customerId: string;
  productId: string;
  productOfferId: string | null;
  orderItemId: string | null;
  grantSource: EntitlementGrantSourceValue;
  expiresAt: Date | null;
  maxConcurrentDevices: number;
  grantSnapshot: Prisma.InputJsonObject;
  grantedById: string | null;
};

@Injectable()
export class EntitlementRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  // Every status, not only ACTIVE: a revoked grant has to keep the customer out.
  getByCustomerAndProduct({
    customerId,
    productId,
  }: {
    customerId: string;
    productId: string;
  }): Promise<{ id: string; status: EntitlementStatusValue }[]> {
    return this.prisma.entitlement.findMany({
      where: { customerId, productId },
      select: { id: true, status: true },
    });
  }

  create(data: EntitlementGrantInput): Promise<{ id: string }> {
    return this.prisma.entitlement.create({
      data,
      select: { id: true },
    });
  }
}
