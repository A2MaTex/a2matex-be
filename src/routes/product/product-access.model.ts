import type { Prisma } from '../../generated/prisma/client.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';

export type ProductAccess = { unrestricted: true } | { unrestricted: false; publisherAccountId: string };

export function buildProductAccessWhere(
  access: ProductAccess,
  status?: ProductStatusType,
): Prisma.ProductWhereInput {
  return {
    deletedAt: null,
    status,
    ...(access.unrestricted ? {} : { publisherAccountId: access.publisherAccountId }),
  };
}
