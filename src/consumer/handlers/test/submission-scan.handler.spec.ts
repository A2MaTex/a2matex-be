import { MessageHandlerResult } from '../../../shared/infrastructure/queue/queue.interface.ts';
import type { ConsumedMessage } from '../../../shared/infrastructure/queue/queue.interface.ts';
import { SUBMISSION_SCAN_MESSAGE_TYPE } from '../../../shared/constants/submission.constant.ts';
import {
  ScanOutcome,
  SubmissionScanService,
} from '../../../routes/submission/scan/submission-scan.service.ts';
import { SubmissionScanHandler } from '../submission-scan.handler.ts';

vi.mock('../../../routes/submission/scan/submission-scan.service.ts', async (original) => {
  const actual =
    await original<typeof import('../../../routes/submission/scan/submission-scan.service.ts')>();
  return { ...actual, SubmissionScanService: class SubmissionScanService {} };
});

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';
const TRACE_ID = 'abcdef0123456789abcdef0123456789';

function consumed(overrides: Record<string, unknown> = {}): ConsumedMessage<unknown> {
  return {
    topic: 'submission.scan.requested',
    partition: 0,
    offset: '1',
    key: SUBMISSION_ID,
    headers: {},
    message: {
      id: `submission-scan:${SUBMISSION_ID}:1`,
      type: SUBMISSION_SCAN_MESSAGE_TYPE,
      occurredAt: '2026-11-13T00:00:00.000Z',
      traceId: TRACE_ID,
      payload: { submissionId: SUBMISSION_ID, scanAttempt: 1 },
      ...overrides,
    },
  } as ConsumedMessage<unknown>;
}

describe('SubmissionScanHandler', () => {
  const run = vi.fn();
  const markTechnicalFailure = vi.fn();
  let handler: SubmissionScanHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new SubmissionScanHandler({
      run,
      markTechnicalFailure,
    } as unknown as SubmissionScanService);
  });

  // Only a message that can never succeed is dead-lettered.
  it.each([
    [ScanOutcome.COMPLETED, MessageHandlerResult.SUCCESS],
    [ScanOutcome.STALE, MessageHandlerResult.SUCCESS],
    [ScanOutcome.ALREADY_DONE, MessageHandlerResult.SUCCESS],
    [ScanOutcome.INVALID, MessageHandlerResult.FAILED],
  ])('maps scan outcome %s to %s', async (outcome, expected) => {
    run.mockResolvedValue(outcome);

    await expect(handler.handle(consumed())).resolves.toBe(expected);
  });

  it('records a technical failure and asks the queue to retry', async () => {
    run.mockRejectedValue(new Error('database down'));

    await expect(handler.handle(consumed())).resolves.toBe(MessageHandlerResult.RETRY);

    expect(markTechnicalFailure).toHaveBeenCalledWith({
      submissionId: SUBMISSION_ID,
      scanAttempt: 1,
    });
  });

  it.each([
    ['an unexpected type', { type: 'something.else' }],
    ['a malformed payload', { payload: { submissionId: 'not-a-uuid' } }],
  ])('dead-letters %s without scanning', async (_label, overrides) => {
    await expect(handler.handle(consumed(overrides))).resolves.toBe(MessageHandlerResult.FAILED);

    expect(run).not.toHaveBeenCalled();
  });

  it('dead-letters a message whose key does not name its Submission', async () => {
    const message = consumed();
    message.key = 'another-id';

    await expect(handler.handle(message)).resolves.toBe(MessageHandlerResult.FAILED);
    expect(run).not.toHaveBeenCalled();
  });
});
