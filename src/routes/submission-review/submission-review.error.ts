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

// An Admin who also publishes may not sign off on a Submission they created.
export const SubmissionSelfReviewForbiddenException = new ForbiddenException(
  'Error.SubmissionSelfReviewForbidden',
);

// Nothing was written, so the Admin may send the exact same request again. Raised when
// the decision could not get the Product lock inside the transaction budget.
export const SubmissionReviewTimeoutException = new ServiceUnavailableException(
  'Error.SubmissionReviewTimeout',
);

// A terminal Submission without `reviewedAt` cannot have come from this module. The
// republish would invent a timestamp, so it stops instead.
export const SubmissionReviewStateInvalidException = new InternalServerErrorException(
  'Error.SubmissionReviewStateInvalid',
);

// The decision stays committed; repeating the identical approval republishes the same
// deterministic message.
export const ProductReleaseBuildPublishFailedException = new ServiceUnavailableException(
  'Error.ProductReleaseBuildPublishFailed',
);
