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

// JSONB keeps neither key order nor empty-vs-omitted `items`, so equality uses a digest.
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

export function storedFeedbackHash(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = SubmissionReviewFeedback.safeParse(value);
  return parsed.success ? canonicalFeedbackHash(parsed.data) : sha256Hex({ unparseable: value });
}

// Per field, never joined: `\s` would match the separator and span two innocuous fields.
function containsForbiddenContent(feedback: SubmissionReviewFeedbackType): boolean {
  const fields = [
    feedback.summary,
    ...(feedback.items ?? []).flatMap((item) => [item.message, item.nodeId ?? '']),
  ];
  return fields.some((field) =>
    SUBMISSION_REVIEW_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(field)),
  );
}

export type ReviewSubmissionInputType = z.infer<typeof ReviewSubmissionInput>;
