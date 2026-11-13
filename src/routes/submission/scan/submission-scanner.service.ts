import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.ts';
import {
  ProductSubmissionSnapshot,
  ReleaseRequestSnapshot,
  SubmissionReviewContextSnapshot,
  type SubmissionScanFindingType,
  type SubmissionScanResultType,
} from '../../../entities/submission.model.ts';
import {
  SUBMISSION_SCAN_MAX_FINDINGS,
  SUBMISSION_SCAN_MAX_REPORTED_NODE_TYPES,
  SUBMISSION_SNAPSHOT_SCHEMA_VERSION,
  SubmissionFindingCode,
  SubmissionFindingSeverity,
} from '../../../shared/constants/submission.constant.ts';
import { EDITOR_GRAPH_MAX_CONTENT_BYTES } from '../../../shared/constants/workflow-validation.constant.ts';
import { NodeDefinitionCatalogContract } from '../../node-catalog/node-definition.model.ts';
import {
  calculateWorkflowRevisionContentHash,
  finalizeWorkflowRevisionContentHash,
  requireJsonObject,
} from '../../workflow-revision/workflow-revision.util.ts';
import { WorkflowRevisionPayloadTooLargeException } from '../../workflow-revision/workflow-revision.error.ts';
import type { WorkflowRevisionSourceSnapshot } from '../../workflow-revision/workflow-revision.model.ts';
import { WorkflowCompilerService } from '../../workflow-compiler/workflow-compiler.service.ts';
import type { NodeDefinitionType } from '../../node-catalog/node-definition.model.ts';
import {
  buildEmbeddedCredentialFindings,
  findUnsupportedAssets,
} from './scanner/submission-policy.validator.ts';
import type { ScanTarget } from '../submission.repo.ts';

type Finding = SubmissionScanFindingType;

// `compilation` is present only when every rule passed; the caller writes it with the scan
// outcome or writes neither.
export type SubmissionScanOutcome = {
  result: SubmissionScanResultType;
  compilation: { runtimeIr: Prisma.InputJsonValue; contentHash: string } | null;
};

type ValidationDiagnostic = {
  code: string;
  message: string;
  nodeId?: string | undefined;
  path: (string | number)[];
};

type SourceOutcome = {
  findings: Finding[];
  source: WorkflowRevisionSourceSnapshot | null;
  // Set when an earlier attempt already finalized; recompilation must converge on it.
  finalizedContentHash: string | null;
};

type CompileOutcome = {
  findings: Finding[];
  truncated: boolean;
  // Returned rather than held on the service, which is a singleton two deliveries share.
  compiled: { runtimeIr: Prisma.InputJsonValue; contentHash: string } | null;
};

// Runtime IR diagnostics keep their own code so an Admin does not read them as graph errors.
function toFinding(diagnostic: ValidationDiagnostic, severity: Finding['severity']): Finding {
  return {
    code: diagnostic.code.startsWith('RUNTIME_IR_')
      ? SubmissionFindingCode.RUNTIME_IR_COMPILATION_FAILED
      : SubmissionFindingCode.EDITOR_GRAPH_INVALID,
    severity,
    message: diagnostic.message,
    ...(diagnostic.nodeId ? { nodeId: diagnostic.nodeId } : {}),
    // Bounded locator only: the rule code and where it fired, never the graph itself.
    details: { rule: diagnostic.code, path: diagnostic.path.join('.') },
  };
}

/**
 * Rule groups 1, 2, 3, 4, 6 and the credential rule of 5 of spec section 10.
 *
 * Compiling against the revision's frozen `nodeDefinitionManifest` rather than the live Node
 * Catalog is what makes a retry deterministic: deactivating a node type can no longer flip a
 * passed revision.
 *
 * Two failure classes must not be confused. A deterministic property of frozen content is a
 * business finding. A malformed system-owned manifest throws, because the data is corrupt
 * rather than wrong — hence the manifest is parsed before the compiler is called, so anything
 * thrown afterwards is content.
 *
 * Group 5's connector/capability policy rule is out of scope, not pending: there are no
 * connector nodes, and a capability is an Android permission the customer grants at run time
 * through the package manifest. Nothing is withheld at scan time.
 */
@Injectable()
export class SubmissionScannerService {
  constructor(
    @Inject(WorkflowCompilerService)
    private readonly workflowCompilerService: WorkflowCompilerService,
  ) {}

  scan(target: ScanTarget): SubmissionScanOutcome {
    const frozenSource = this.checkFrozenSourceIntegrity(target);
    const snapshots = this.checkSnapshotIntegrity(target);

    // Nothing readable to compile, so the pipeline stops rather than guessing.
    if (!frozenSource.source) {
      return {
        result: buildScanResult([...frozenSource.findings, ...snapshots], false),
        compilation: null,
      };
    }

    const compiled = this.compileFrozenSource({
      source: frozenSource.source,
      finalizedContentHash: frozenSource.finalizedContentHash,
    });
    // Reads the frozen graph, so a workflow that failed to compile is still checked.
    const policy = [
      ...buildEmbeddedCredentialFindings(frozenSource.source.editorGraph),
      ...findUnsupportedAssets(frozenSource.source.editorGraph),
    ];
    const result = buildScanResult(
      [...frozenSource.findings, ...compiled.findings, ...policy, ...snapshots],
      compiled.truncated,
    );

    // A revision must never carry an authoritative Runtime IR while its own scan failed.
    const finalizable = result.summary.errors === 0 && frozenSource.finalizedContentHash === null;

    return { result, compilation: finalizable ? compiled.compiled : null };
  }

  // Rule group 1.
  private checkFrozenSourceIntegrity(target: ScanTarget): SourceOutcome {
    const revision = target.WorkflowRevision;
    const findings: Finding[] = [];

    // Written in one statement, so a split state means a write outside the application.
    const hasRuntimeIr = revision.runtimeIr !== null;
    const hasContentHash = revision.contentHash !== null;
    if (hasRuntimeIr !== hasContentHash) {
      findings.push(
        error(
          SubmissionFindingCode.REVISION_COMPILATION_STATE_INVALID,
          'The frozen revision has only one of its two compiled fields',
        ),
      );
    }

    let source: WorkflowRevisionSourceSnapshot | null = null;
    try {
      source = {
        editorGraph: requireJsonObject(revision.editorGraph),
        inputSchema: requireJsonObject(revision.inputSchema),
        nodeDefinitionManifest: requireJsonObject(revision.nodeDefinitionManifest),
        capabilityManifest: requireJsonObject(revision.capabilityManifest),
        validationSummary: requireJsonObject(revision.validationSummary),
      };
    } catch {
      findings.push(
        error(
          SubmissionFindingCode.REVISION_CONTENT_INVALID,
          'A frozen revision document is not a JSON object',
        ),
      );
    }

    if (!isSha256Hex(revision.sourceDraftContentHash)) {
      findings.push(
        error(
          SubmissionFindingCode.REVISION_CONTENT_INVALID,
          'The recorded source draft hash is not a SHA-256 digest',
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

    if (source && hasRuntimeIr && hasContentHash) {
      const stored = calculateWorkflowRevisionContentHash({
        ...source,
        runtimeIr: revision.runtimeIr as Prisma.JsonObject,
      });
      // Only a write outside the application reaches here: an operator problem, not a
      // Publisher one, so it must not land as a FAILED scan they get judged on.
      if (stored !== revision.contentHash) {
        throw new Error('Finalized Workflow Revision does not match its recorded hash');
      }
    }

    return {
      findings,
      source,
      finalizedContentHash: hasRuntimeIr && hasContentHash ? revision.contentHash : null,
    };
  }

  // Rule groups 2, 3 and 4.
  private compileFrozenSource({
    source,
    finalizedContentHash,
  }: {
    source: WorkflowRevisionSourceSnapshot;
    finalizedContentHash: string | null;
  }): CompileOutcome {
    // `WorkflowValidationService.validate` gates on this before parsing and the compiler does
    // not, so without this the 1 MiB graph limit would leave this path entirely.
    if (exceedsEditorGraphLimit(source.editorGraph)) {
      return {
        truncated: false,
        compiled: null,
        findings: [
          error(
            SubmissionFindingCode.EDITOR_GRAPH_INVALID,
            'The frozen Editor Graph exceeds the size the validation engine accepts',
          ),
        ],
      };
    }

    // Loosely first: creation freezes whatever the catalog offered, so a node type with no
    // definition is content to report, and the strict parse below rejects an empty list.
    const entries = readFrozenDefinitionEntries(source.nodeDefinitionManifest);
    const missing = missingNodeTypes(source.editorGraph, entries);
    if (missing.length > 0) {
      return {
        truncated: false,
        compiled: null,
        findings: [
          {
            code: SubmissionFindingCode.NODE_DEFINITION_MISSING,
            severity: SubmissionFindingSeverity.ERROR,
            message: 'The frozen workflow uses a node type the Node Catalog did not offer',
            details: {
              nodeTypes: missing.slice(0, SUBMISSION_SCAN_MAX_REPORTED_NODE_TYPES),
              count: missing.length,
            },
          },
        ],
      };
    }
    if (entries.length === 0) {
      return {
        truncated: false,
        compiled: null,
        findings: [
          error(
            SubmissionFindingCode.NODE_DEFINITION_MISSING,
            'The frozen workflow contains no usable node',
          ),
        ],
      };
    }

    const definitions = toCompilerDefinitions(entries);

    let compiled: ReturnType<WorkflowCompilerService['compileWorkflow']>;
    try {
      compiled = this.workflowCompilerService.compileWorkflow(
        source.editorGraph,
        source.inputSchema,
        definitions,
      );
    } catch {
      // The manifest already parsed, so this is publisher content and retrying cannot help.
      return {
        truncated: false,
        compiled: null,
        findings: [
          error(
            SubmissionFindingCode.RUNTIME_IR_COMPILATION_FAILED,
            'The frozen workflow could not be compiled into a valid Runtime IR document',
          ),
        ],
      };
    }

    const findings = [
      ...compiled.validation.errors.map((item) => toFinding(item, SubmissionFindingSeverity.ERROR)),
      ...compiled.validation.warnings.map((item) =>
        toFinding(item, SubmissionFindingSeverity.WARNING),
      ),
    ];
    if (!compiled.success) {
      return { findings, truncated: compiled.validation.truncated, compiled: null };
    }

    // Review and Product Release read this manifest as evidence, so it must match the
    // compiled document exactly.
    const frozenCapabilities = readStringArray(source.capabilityManifest, 'capabilities');
    if (!isSameOrderedList(frozenCapabilities, compiled.runtimeIr.requiredCapabilities)) {
      findings.push(
        error(
          SubmissionFindingCode.RUNTIME_IR_CAPABILITY_MISMATCH,
          'The compiled required capabilities do not match the frozen capability manifest',
        ),
      );
      return { findings, truncated: compiled.validation.truncated, compiled: null };
    }

    let contentHash: string;
    try {
      contentHash = finalizeWorkflowRevisionContentHash({
        source,
        runtimeIr: compiled.runtimeIr as unknown as Prisma.JsonObject,
      });
    } catch (thrown) {
      if (thrown === WorkflowRevisionPayloadTooLargeException) {
        findings.push(
          error(
            SubmissionFindingCode.RUNTIME_IR_COMPILATION_FAILED,
            'The compiled revision exceeds the size a Workflow Revision may store',
          ),
        );
        return { findings, truncated: compiled.validation.truncated, compiled: null };
      }
      throw thrown;
    }

    // Unreachable through the application: a passed scan leaves the Submission outside every
    // retryable status. Same category as the hash check above.
    if (finalizedContentHash !== null && finalizedContentHash !== contentHash) {
      throw new Error('Finalized Workflow Revision does not match its recompiled source');
    }

    return {
      findings,
      truncated: compiled.validation.truncated,
      compiled: { runtimeIr: compiled.runtimeIr as Prisma.InputJsonValue, contentHash },
    };
  }

  // Rule group 6.
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

// System-owned, so an unreadable shape is corrupt data and throws. What it contains is the
// caller's business rule, not this function's.
function exceedsEditorGraphLimit(editorGraph: Prisma.JsonObject): boolean {
  return (
    Buffer.byteLength(JSON.stringify(editorGraph) ?? '', 'utf8') > EDITOR_GRAPH_MAX_CONTENT_BYTES
  );
}

function readFrozenDefinitionEntries(manifest: Prisma.JsonObject): Prisma.JsonObject[] {
  if (!Array.isArray(manifest.definitions)) {
    throw new Error('Frozen node definition manifest does not contain a definition array');
  }
  return manifest.definitions.map((definition) => {
    if (definition === null || Array.isArray(definition) || typeof definition !== 'object') {
      throw new Error('Frozen node definition entry is not an object');
    }
    return definition;
  });
}

// Frozen entries carry two fields the strict compiler contract rejects: the catalog
// fingerprint, and the capability list under its storage name.
function toCompilerDefinitions(entries: Prisma.JsonObject[]): NodeDefinitionType[] {
  return NodeDefinitionCatalogContract.parse(
    entries.map(({ capabilityCodes, contentHash: _contentHash, ...rest }) => ({
      ...rest,
      capabilities: capabilityCodes,
    })),
  );
}

function missingNodeTypes(editorGraph: Prisma.JsonObject, entries: Prisma.JsonObject[]): string[] {
  const available = new Set(
    entries.map(({ type }) => type).filter((type): type is string => typeof type === 'string'),
  );
  const nodes = Array.isArray(editorGraph.nodes) ? editorGraph.nodes : [];
  const missing = new Set<string>();

  for (const node of nodes) {
    if (node === null || Array.isArray(node) || typeof node !== 'object') {
      continue;
    }
    if (typeof node.type === 'string' && !available.has(node.type)) {
      missing.add(node.type);
    }
  }
  return [...missing];
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
      // What was evaluated, not what the finished scanner will evaluate.
      totalRules: 6,
      passed: errors === 0 ? 6 : 0,
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

function isSha256Hex(value: string | null): boolean {
  return value !== null && /^[0-9a-f]{64}$/.test(value);
}

function isSameOrderedList(left: string[] | null, right: string[]): boolean {
  return (
    left !== null && left.length === right.length && left.every((item, at) => item === right[at])
  );
}

function readStringArray(value: unknown, key: string): string[] | null {
  const read = readKey(value, key);
  return Array.isArray(read) && read.every((item) => typeof item === 'string') ? read : null;
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
