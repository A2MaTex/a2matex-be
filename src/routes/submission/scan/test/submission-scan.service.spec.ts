import { TransactionService } from '../../../../shared/services/transaction.service.ts';
import { SubmissionRepo } from '../../submission.repo.ts';
import { ScanOutcome, SubmissionScanService } from '../submission-scan.service.ts';
import { SubmissionScannerService } from '../submission-scanner.service.ts';
import { WorkflowRevisionRepo } from '../../../workflow-revision/workflow-revision.repo.ts';

vi.mock('../../../../shared/services/transaction.service.ts', () => ({
  TransactionService: class TransactionService {},
}));
vi.mock('../../submission.repo.ts', () => ({ SubmissionRepo: class SubmissionRepo {} }));
vi.mock('../submission-scanner.service.ts', () => ({
  SubmissionScannerService: class SubmissionScannerService {},
}));
vi.mock('../../../workflow-revision/workflow-revision.repo.ts', () => ({
  WorkflowRevisionRepo: class WorkflowRevisionRepo {},
}));

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';
const REVISION_ID = '22222222-2222-4222-8222-222222222222';
const COMPILATION = { runtimeIr: { formatVersion: 1 }, contentHash: 'c'.repeat(64) };

function scanResult(errors: number) {
  return {
    schemaVersion: 1,
    summary: { totalRules: 6, passed: errors === 0 ? 6 : 0, warnings: 0, errors, truncated: false },
    findings: [],
  };
}

describe('SubmissionScanService persistence', () => {
  const loadForScan = vi.fn();
  const claimScan = vi.fn();
  const persistScanOutcome = vi.fn();
  const finalizeCompilation = vi.fn();
  const scan = vi.fn();
  const runInTransaction = vi.fn((callback: () => unknown) => callback());
  let service: SubmissionScanService;

  beforeEach(() => {
    vi.clearAllMocks();
    loadForScan.mockResolvedValue({
      id: SUBMISSION_ID,
      scanAttempt: 1,
      scanStatus: 'QUEUED',
      WorkflowRevision: { id: REVISION_ID },
    });
    claimScan.mockResolvedValue(true);
    persistScanOutcome.mockResolvedValue(true);

    service = new SubmissionScanService(
      { loadForScan, claimScan, persistScanOutcome } as unknown as SubmissionRepo,
      { scan } as unknown as SubmissionScannerService,
      { finalizeCompilation } as unknown as WorkflowRevisionRepo,
      { runInTransaction } as unknown as TransactionService,
    );
  });

  function run() {
    return service.run({ submissionId: SUBMISSION_ID, scanAttempt: 1 });
  }

  it('finalizes the revision in the same transaction as a passed outcome', async () => {
    scan.mockReturnValue({ result: scanResult(0), compilation: COMPILATION });

    await expect(run()).resolves.toBe(ScanOutcome.COMPLETED);

    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(persistScanOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ scanStatus: 'PASSED', scanAttempt: 1 }),
    );
    expect(finalizeCompilation).toHaveBeenCalledWith({
      workflowRevisionId: REVISION_ID,
      runtimeIr: COMPILATION.runtimeIr,
      contentHash: COMPILATION.contentHash,
    });
  });

  it('leaves the revision pending when the scan failed on content', async () => {
    scan.mockReturnValue({ result: scanResult(2), compilation: null });

    await expect(run()).resolves.toBe(ScanOutcome.COMPLETED);

    expect(persistScanOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ scanStatus: 'FAILED' }),
    );
    expect(finalizeCompilation).not.toHaveBeenCalled();
  });

  // An Admin retry moved the counter while this attempt was compiling. Its result is
  // unwanted, and an unwanted result must not finalize the revision either.
  it('writes no revision and reports STALE when the attempt was superseded', async () => {
    scan.mockReturnValue({ result: scanResult(0), compilation: COMPILATION });
    persistScanOutcome.mockResolvedValue(false);

    await expect(run()).resolves.toBe(ScanOutcome.STALE);

    expect(finalizeCompilation).not.toHaveBeenCalled();
  });

  it('does not scan a Submission whose scan already reached a terminal status', async () => {
    loadForScan.mockResolvedValue({
      id: SUBMISSION_ID,
      scanAttempt: 1,
      scanStatus: 'PASSED',
      WorkflowRevision: { id: REVISION_ID },
    });

    await expect(run()).resolves.toBe(ScanOutcome.ALREADY_DONE);

    expect(scan).not.toHaveBeenCalled();
    expect(finalizeCompilation).not.toHaveBeenCalled();
  });

  it('performs no work for a stale attempt', async () => {
    loadForScan.mockResolvedValue({
      id: SUBMISSION_ID,
      scanAttempt: 3,
      scanStatus: 'QUEUED',
      WorkflowRevision: { id: REVISION_ID },
    });

    await expect(run()).resolves.toBe(ScanOutcome.STALE);

    expect(claimScan).not.toHaveBeenCalled();
    expect(finalizeCompilation).not.toHaveBeenCalled();
  });
});
