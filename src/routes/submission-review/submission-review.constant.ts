import {
  SubmissionStatus,
  type SubmissionStatusType,
} from '../../shared/constants/submission.constant.ts';

export const SubmissionReviewDecision = {
  APPROVE: 'APPROVE',
  REQUEST_CHANGES: 'REQUEST_CHANGES',
  REJECT: 'REJECT',
} as const;

export type SubmissionReviewDecisionType =
  (typeof SubmissionReviewDecision)[keyof typeof SubmissionReviewDecision];

// One terminal status per decision. This map is the whole transition contract: a
// decision can never produce a status that is not listed here.
export const DECISION_STATUS: Record<SubmissionReviewDecisionType, SubmissionStatusType> = {
  [SubmissionReviewDecision.APPROVE]: SubmissionStatus.APPROVED,
  [SubmissionReviewDecision.REQUEST_CHANGES]: SubmissionStatus.CHANGES_REQUESTED,
  [SubmissionReviewDecision.REJECT]: SubmissionStatus.REJECTED,
};

// A decision that refuses the current Submission owes the Publisher something to act on.
export const FEEDBACK_REQUIRED_DECISIONS: SubmissionReviewDecisionType[] = [
  SubmissionReviewDecision.REQUEST_CHANGES,
  SubmissionReviewDecision.REJECT,
];

// Derived, never re-listed: a new decision must not be able to add a terminal status
// here and forget it there, which would cost the replay branch silently.
export const TERMINAL_REVIEW_STATUSES: SubmissionStatusType[] = Object.values(DECISION_STATUS);

// The create path holds the Product lock for up to SUBMISSION_CREATE_TX_TIMEOUT_MS while
// it canonicalises a revision. An approval waits on that same lock, so Prisma's 5s
// default would abort the decision for a reason that has nothing to do with it.
export const SUBMISSION_REVIEW_TX_TIMEOUT_MS = 20_000;
export const SUBMISSION_REVIEW_TX_MAX_WAIT_MS = 5_000;

export const PRODUCT_RELEASE_BUILD_MESSAGE_TYPE = 'product-release.build.requested.v1';
export const PRODUCT_RELEASE_BUILD_MESSAGE_ID_PREFIX = 'product-release-build';

// Feedback reaches a Publisher as display text, so a paste carrying machine output is
// refused rather than trimmed: a credential cannot be un-sent once it is stored.
export const SUBMISSION_REVIEW_FORBIDDEN_PATTERNS = [
  /bearer\s+[\w.~+/-]{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\./,
  /[?&](?:x-amz-signature|x-amz-credential|signature|sig|token)=/i,
] as const;
