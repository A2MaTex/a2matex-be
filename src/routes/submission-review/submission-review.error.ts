import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';

// The 422 case lives as a schema issue message, not as an exception.

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
