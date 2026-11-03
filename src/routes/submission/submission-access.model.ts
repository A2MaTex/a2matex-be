import type { SubmissionStatusType } from '../../shared/constants/submission.constant.ts';

export type SubmissionAccess =
  { unrestricted: true } | { unrestricted: false; publisherAccountId: string };

// Detail narrows the same predicate to one id rather than writing a second one:
// this is the ownership boundary, and two copies of it are two things to drift.
export type SubmissionScopeFilter = {
  status?: SubmissionStatusType;
  productId?: string;
};
