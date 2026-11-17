import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

// Missing IDs and cross-owner reads answer the same way so OWN callers cannot probe
// for Submissions belonging to another Publisher.
export const SubmissionNotFoundException = new NotFoundException('Error.SubmissionNotFound');

export const SubmissionAccessDeniedException = new ForbiddenException(
  'Error.SubmissionAccessDenied',
);

export const SubmissionAlreadyOpenException = new ConflictException('Error.SubmissionAlreadyOpen');

// Per-Product numbering is serialised by the Product lock, so a collision means that
// invariant broke rather than the caller doing anything wrong.
export const SubmissionNumberConflictException = new ConflictException(
  'Error.SubmissionNumberConflict',
);

export const SubmissionScanNotRetryableException = new ConflictException(
  'Error.SubmissionScanNotRetryable',
);

export const SubmissionIdempotencyKeyReusedException = new ConflictException(
  'Error.SubmissionIdempotencyKeyReused',
);

export const SubmissionProductIncompleteException = new UnprocessableEntityException([
  {
    message: 'Error.SubmissionProductIncomplete',
    path: 'productId',
  },
]);

export const SubmissionIdempotencyKeyRequiredException = new UnprocessableEntityException([
  {
    message: 'Error.SubmissionIdempotencyKeyRequired',
    path: 'idempotency-key',
  },
]);

// The attempt rolled back entirely, so retrying the same idempotency key is safe and
// is what the client should do.
export const SubmissionCreateTimeoutException = new ServiceUnavailableException(
  'Error.SubmissionCreateTimeout',
);

// The Submission and its queued scan stay committed; the client retries the same
// idempotency key rather than generating a new one.
export const SubmissionScanPublishFailedException = new ServiceUnavailableException(
  'Error.SubmissionScanPublishFailed',
);
