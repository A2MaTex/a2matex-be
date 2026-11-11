import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';

// The two 422 cases live as schema issue messages, not as exceptions.

export const SubmissionNotReadyForReviewException = new ConflictException(
  'Error.SubmissionNotReadyForReview',
);

export const SubmissionAlreadyReviewedException = new ConflictException(
  'Error.SubmissionAlreadyReviewed',
);

export const SubmissionReviewConflictException = new ConflictException(
  'Error.SubmissionReviewConflict',
);

export const SubmissionScanFailedException = new ConflictException('Error.SubmissionScanFailed');

export const SubmissionScanIncompleteException = new ConflictException(
  'Error.SubmissionScanIncomplete',
);

export const SubmissionNotEligibleForApprovalException = new ConflictException(
  'Error.SubmissionNotEligibleForApproval',
);

export const SubmissionSelfReviewForbiddenException = new ForbiddenException(
  'Error.SubmissionSelfReviewForbidden',
);

export const SubmissionReviewTimeoutException = new ServiceUnavailableException(
  'Error.SubmissionReviewTimeout',
);

export const SubmissionReviewStateInvalidException = new InternalServerErrorException(
  'Error.SubmissionReviewStateInvalid',
);

export const ProductReleaseBuildPublishFailedException = new ServiceUnavailableException(
  'Error.ProductReleaseBuildPublishFailed',
);
