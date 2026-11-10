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

export const DECISION_STATUS: Record<SubmissionReviewDecisionType, SubmissionStatusType> = {
  [SubmissionReviewDecision.APPROVE]: SubmissionStatus.APPROVED,
  [SubmissionReviewDecision.REQUEST_CHANGES]: SubmissionStatus.CHANGES_REQUESTED,
  [SubmissionReviewDecision.REJECT]: SubmissionStatus.REJECTED,
};

export const FEEDBACK_REQUIRED_DECISIONS: SubmissionReviewDecisionType[] = [
  SubmissionReviewDecision.REQUEST_CHANGES,
  SubmissionReviewDecision.REJECT,
];

export const TERMINAL_REVIEW_STATUSES: SubmissionStatusType[] = Object.values(DECISION_STATUS);

// An approval waits on the Product lock the create path holds, so Prisma's 5s default
// would abort the decision for a reason that has nothing to do with it.
export const SUBMISSION_REVIEW_TX_TIMEOUT_MS = 20_000;
export const SUBMISSION_REVIEW_TX_MAX_WAIT_MS = 5_000;

export const PRODUCT_RELEASE_BUILD_MESSAGE_TYPE = 'product-release.build.requested.v1';
export const PRODUCT_RELEASE_BUILD_MESSAGE_ID_PREFIX = 'product-release-build';

export const SUBMISSION_REVIEW_EMAIL_TIMEOUT_MS = 5_000;

export const SUBMISSION_REVIEW_EMAIL_COPY: Record<
  SubmissionReviewDecisionType,
  { subject: string; nextStep: string }
> = {
  [SubmissionReviewDecision.APPROVE]: {
    subject: 'Bản gửi đã được duyệt',
    nextStep:
      'Bản phát hành đang được đóng gói. Sản phẩm sẽ xuất hiện trên Marketplace sau khi bước này hoàn tất.',
  },
  [SubmissionReviewDecision.REQUEST_CHANGES]: {
    subject: 'Bản gửi cần chỉnh sửa',
    nextStep: 'Vui lòng xem nhận xét trong Publisher Portal rồi gửi lại bản mới.',
  },
  [SubmissionReviewDecision.REJECT]: {
    subject: 'Bản gửi bị từ chối',
    nextStep: 'Vui lòng xem nhận xét trong Publisher Portal trước khi gửi bản tiếp theo.',
  },
};
// Feedback reaches a Publisher as display text, so a paste carrying machine output is
// refused rather than trimmed: a credential cannot be un-sent once it is stored.
export const SUBMISSION_REVIEW_FORBIDDEN_PATTERNS = [
  /bearer\s+[\w.~+/-]{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\./,
  /[?&](?:x-amz-signature|x-amz-credential|signature|sig|token)=/i,
] as const;