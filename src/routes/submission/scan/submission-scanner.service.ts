import { Inject, Injectable } from '@nestjs/common';
import {
  ProductSubmissionSnapshot,
  ReleaseRequestSnapshot,
  SubmissionReviewContextSnapshot,
  type SubmissionScanFindingType,
  type SubmissionScanResultType,
} from '../../../entities/submission.model.ts';
import {
  SUBMISSION_SCAN_MAX_FINDINGS,
  SUBMISSION_SNAPSHOT_SCHEMA_VERSION,
  SubmissionFindingCode,
  SubmissionFindingSeverity,
} from '../../../shared/constants/submission.constant.ts';
import {
  calculateWorkflowRevisionContentHash,
  requireJsonObject,
} from '../../workflow-revision/workflow-revision.util.ts';
import { WorkflowValidationService } from '../../workflow-validation/workflow-validation.service.ts';
import { EditorGraphPayloadTooLargeException } from '../../workflow-validation/workflow-validation.error.ts';
import type { ScanTarget } from '../submission.repo.ts';

type Finding = SubmissionScanFindingType;

type EditorGraphOutcome = { findings: Finding[]; truncated: boolean };

type ValidationDiagnostic = {
  code: string;
  message: string;
  nodeId?: string | undefined;
  path: (string | number)[];
};

function toFinding(diagnostic: ValidationDiagnostic, severity: Finding['severity']): Finding {
  return {
    code: SubmissionFindingCode.EDITOR_GRAPH_INVALID,
    severity,
    message: diagnostic.message,
    ...(diagnostic.nodeId ? { nodeId: diagnostic.nodeId } : {}),
    // Bounded locator only: the rule code and where it fired, never the graph itself.
    details: { rule: diagnostic.code, path: diagnostic.path.join('.') },
  };
}

/**
 * In-memory rule pipeline over the frozen Submission and its WorkflowRevision.
 *
 * It is NOT fully deterministic, despite what spec section 10 asks for. Rule group 2
 * delegates to WorkflowValidationService, which spec section 10 also mandates reusing,
 * and that service reads the live Node Catalog. Deactivate a node type and the same
 * immutable revision that scanned PASSED will scan FAILED on a later retry. The
 * revision froze `nodeDefinitionManifest` for exactly this reason; rule group 4 is
 * where it starts being read, and resolving this tension belongs with that work.
 *
 * Rule groups 1, 2 and 6 of spec section 10 are implemented here. Groups 3, 4 and 5 —
 * Runtime IR v1 validation, frozen Node Definition consistency, and the MVP policy
 * restrictions — are NOT, because nothing in this repository can read inside
 * `runtimeIr` yet and the other two depend on that.
 *
 * Section 10 says READY_FOR_REVIEW must not be emitted until the Runtime IR stage
 * exists. This module ships before it does, deliberately, so the end-to-end flow can
 * run. The consequence is real and worth stating plainly: rule 2 proves the Editor
 * Graph is sound, which says nothing about the Runtime IR that actually executes on a
 * customer's device. A malformed one passes this scan.
 *
 * `SUBMISSION_SCANNER_VERSION` stays on 0.1.x until those three land, so a stored
 * result always says which rules produced it.
 */
@Injectable()
export class SubmissionScannerService {
  constructor(
    @Inject(WorkflowValidationService)
    private readonly workflowValidationService: WorkflowValidationService,
  ) {}

  async scan(target: ScanTarget): Promise<SubmissionScanResultType> {
    const editorGraph = await this.checkEditorGraph(target);
    const findings: Finding[] = [
      ...this.checkRevisionIntegrity(target),
      ...editorGraph.findings,
      ...this.checkSnapshotIntegrity(target),
    ];

    // The graph engine caps its own diagnostics, so a truncation there must survive
    // into the summary even when the scan itself stays under its cap.
    return buildScanResult(findings, editorGraph.truncated);
  }

  // Rule group 1: the snapshot must be exactly what was frozen.
  private checkRevisionIntegrity(target: ScanTarget): Finding[] {
    const revision = target.WorkflowRevision;

    let recomputed: string;
    try {
      recomputed = calculateWorkflowRevisionContentHash({
        editorGraph: requireJsonObject(revision.editorGraph),
        runtimeIr: requireJsonObject(revision.runtimeIr),
        inputSchema: requireJsonObject(revision.inputSchema),
        nodeDefinitionManifest: requireJsonObject(revision.nodeDefinitionManifest),
        capabilityManifest: requireJsonObject(revision.capabilityManifest),
        validationSummary: requireJsonObject(revision.validationSummary),
        testSummary: requireJsonObject(revision.testSummary),
      });
    } catch {
      return [
        error(
          SubmissionFindingCode.REVISION_CONTENT_INVALID,
          'A frozen revision document is not a JSON object',
        ),
      ];
    }

    const findings: Finding[] = [];
    if (recomputed !== revision.contentHash) {
      findings.push(
        error(
          SubmissionFindingCode.REVISION_CONTENT_HASH_MISMATCH,
          'The frozen workflow no longer matches the hash recorded when it was frozen',
        ),
      );
    }
    // The snapshot names its own Project; it must be the one the revision was cut from.
    const snapshotProjectId = readString(target.productSnapshot, 'projectId');
    if (snapshotProjectId !== revision.projectId) {
      findings.push(
        error(
          SubmissionFindingCode.REVISION_IDENTITY_MISMATCH,
          'The Product snapshot and the frozen revision disagree about the Project',
        ),
      );
    }
    const snapshotProductId = readString(target.productSnapshot, 'productId');
    if (snapshotProductId !== target.productId) {
      findings.push(
        error(
          SubmissionFindingCode.REVISION_IDENTITY_MISMATCH,
          'The Product snapshot and the Submission disagree about the Product',
        ),
      );
    }
    return findings;
  }

  // Rule group 2: reuse the engine Studio already validates against. Severity comes
  // from which list a diagnostic landed in, so a warning never fails a Submission.
  private async checkEditorGraph(target: ScanTarget): Promise<EditorGraphOutcome> {
    let result: Awaited<ReturnType<WorkflowValidationService['validate']>>;
    try {
      result = await this.workflowValidationService.validate(target.WorkflowRevision.editorGraph);
    } catch (thrown) {
      // A graph over the engine's size limit is a deterministic property of the frozen
      // content: retrying it five times and dead-lettering helps nobody, so it becomes
      // a finding. Anything else thrown here is infrastructure — an unparseable
      // catalog row, say — and must stay a technical failure the queue can retry.
      if (thrown === EditorGraphPayloadTooLargeException) {
        return {
          truncated: false,
          findings: [
            error(
              SubmissionFindingCode.EDITOR_GRAPH_INVALID,
              'The frozen Editor Graph exceeds the size the validation engine accepts',
            ),
          ],
        };
      }
      throw thrown;
    }

    return {
      truncated: result.truncated,
      findings: [
        ...result.errors.map((item) => toFinding(item, SubmissionFindingSeverity.ERROR)),
        ...result.warnings.map((item) => toFinding(item, SubmissionFindingSeverity.WARNING)),
      ],
    };
  }

  // Rule group 6: the Publisher-authored snapshots must still satisfy their contract.
  private checkSnapshotIntegrity(target: ScanTarget): Finding[] {
    return [
      checkSnapshot(
        ProductSubmissionSnapshot,
        target.productSnapshot,
        SubmissionFindingCode.PRODUCT_SNAPSHOT_INVALID,
        'Product snapshot',
      ),
      checkSnapshot(
        ReleaseRequestSnapshot,
        target.releaseRequest,
        SubmissionFindingCode.RELEASE_REQUEST_INVALID,
        'Release request',
      ),
      checkSnapshot(
        SubmissionReviewContextSnapshot,
        target.reviewContext,
        SubmissionFindingCode.REVIEW_CONTEXT_INVALID,
        'Review context',
      ),
    ].filter((finding): finding is Finding => finding !== null);
  }
}

function checkSnapshot(
  schema: { safeParse: (value: unknown) => { success: boolean } },
  value: unknown,
  code: string,
  label: string,
): Finding | null {
  // Only a NEWER version means the scanner is behind the data rather than the data
  // being wrong. Everything else — missing, older, or not a number at all — is the
  // corruption this rule group exists to catch, so it must reach the parse below.
  const version = readNumber(value, 'schemaVersion');
  if (version !== null && version > SUBMISSION_SNAPSHOT_SCHEMA_VERSION) {
    return {
      code,
      severity: SubmissionFindingSeverity.WARNING,
      message: `${label} was written by a newer snapshot version than this scanner understands`,
      details: { schemaVersion: version },
    };
  }
  return schema.safeParse(value).success
    ? null
    : error(code, `${label} does not satisfy its stored contract`);
}

function buildScanResult(all: Finding[], upstreamTruncated: boolean): SubmissionScanResultType {
  const truncated = upstreamTruncated || all.length > SUBMISSION_SCAN_MAX_FINDINGS;
  const findings = truncated ? all.slice(0, SUBMISSION_SCAN_MAX_FINDINGS) : all;
  const counted = (severity: string) => all.filter((item) => item.severity === severity).length;
  const errors = counted(SubmissionFindingSeverity.ERROR);

  return {
    schemaVersion: SUBMISSION_SNAPSHOT_SCHEMA_VERSION,
    summary: {
      // Three rule groups run today; the count is what was evaluated, not what the
      // finished scanner will evaluate.
      totalRules: 3,
      passed: errors === 0 ? 3 : 0,
      warnings: counted(SubmissionFindingSeverity.WARNING),
      errors,
      truncated,
    },
    findings,
  };
}

function error(code: string, message: string): Finding {
  return { code, severity: SubmissionFindingSeverity.ERROR, message };
}

function readString(value: unknown, key: string): string | null {
  const read = readKey(value, key);
  return typeof read === 'string' ? read : null;
}

function readNumber(value: unknown, key: string): number | null {
  const read = readKey(value, key);
  return typeof read === 'number' ? read : null;
}

function readKey(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
