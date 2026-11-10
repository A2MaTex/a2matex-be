import { z } from 'zod';
import {
  SubmissionReviewFeedback,
  type SubmissionReviewFeedbackType,
} from '../../entities/submission.model.ts';
import { sha256Hex } from '../node-catalog/node-catalog.util.ts';
import {
  FEEDBACK_REQUIRED_DECISIONS,
  SUBMISSION_REVIEW_FORBIDDEN_PATTERNS,
  SubmissionReviewDecision,
} from './submission-review.constant.ts';

export const ReviewSubmissionInput = z
  .object({
    decision: z.enum([
      SubmissionReviewDecision.APPROVE,
      SubmissionReviewDecision.REQUEST_CHANGES,
      SubmissionReviewDecision.REJECT,
    ]),
    feedback: SubmissionReviewFeedback.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.feedback) {
      if (FEEDBACK_REQUIRED_DECISIONS.includes(value.decision)) {
        ctx.addIssue({
          code: 'custom',
          path: ['feedback'],
          message: 'Error.SubmissionReviewFeedbackRequired',
        });
      }
      return;
    }
    if (containsForbiddenContent(value.feedback)) {
      ctx.addIssue({
        code: 'custom',
        path: ['feedback'],
        message: 'Error.InvalidSubmissionReviewFeedback',
      });
    }
  });

// Stored feedback is JSONB: Postgres keeps neither key order nor the difference between
// an omitted and an empty `items`. Equality is therefore decided on a canonical digest
// of the parsed value, never on the request body as it was written.
export function canonicalFeedbackHash(
  feedback: SubmissionReviewFeedbackType | null | undefined,
): string | null {
  if (!feedback) {
    return null;
  }
  return sha256Hex({
    summary: feedback.summary,
    items: (feedback.items ?? []).map(({ message, nodeId }) => ({
      message,
      nodeId: nodeId ?? null,
    })),
  });
}

// A stored value that no longer parses must not compare equal to anything: hashing it
// raw makes the replay a conflict instead of a silent idempotent success.
export function storedFeedbackHash(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = SubmissionReviewFeedback.safeParse(value);
  return parsed.success ? canonicalFeedbackHash(parsed.data) : sha256Hex({ unparseable: value });
}

function containsForbiddenContent(feedback: SubmissionReviewFeedbackType): boolean {
  const text = [
    feedback.summary,
    ...(feedback.items ?? []).flatMap((item) => [item.message, item.nodeId ?? '']),
  ].join('\n');
  return SUBMISSION_REVIEW_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text));
}

export type ReviewSubmissionInputType = z.infer<typeof ReviewSubmissionInput>;
