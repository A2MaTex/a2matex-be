import type { Prisma } from '../../generated/prisma/client.ts';
import type { SubmissionStatusType } from '../../shared/constants/submission.constant.ts';

export type SubmissionAccess =
  { unrestricted: true } | { unrestricted: false; publisherAccountId: string };

export type SubmissionListFilter = {
  status?: SubmissionStatusType;
  productId?: string;
};

// Ownership is never stored on Submission; it is always derived through Product so
// an OWN caller cannot reach another Publisher's record.
export function buildSubmissionAccessWhere(
  access: SubmissionAccess,
  filter: SubmissionListFilter = {},
): Prisma.SubmissionWhereInput {
  return {
    deletedAt: null,
    status: filter.status,
    productId: filter.productId,
    Product: {
      deletedAt: null,
      ...(access.unrestricted ? {} : { publisherAccountId: access.publisherAccountId }),
    },
  };
}
