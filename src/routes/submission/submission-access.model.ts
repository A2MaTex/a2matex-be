import type { SubmissionStatusType } from '../../shared/constants/submission.constant.ts';

export type SubmissionAccess =
  { unrestricted: true } | { unrestricted: false; publisherAccountId: string };

export type SubmissionListFilter = {
  status?: SubmissionStatusType;
  productId?: string;
};
