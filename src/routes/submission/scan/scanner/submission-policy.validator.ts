import type { Prisma } from '../../../../generated/prisma/client.ts';
import type { SubmissionScanFindingType } from '../../../../entities/submission.model.ts';
import {
  SUBMISSION_SCAN_MAX_CREDENTIAL_FINDINGS,
  SubmissionFindingCode,
  SubmissionFindingSeverity,
} from '../../../../shared/constants/submission.constant.ts';

// Creation rejects an asset-bearing graph; spec section 10 puts the rule in the scan too.
export function findUnsupportedAssets(editorGraph: Prisma.JsonObject): SubmissionScanFindingType[] {
  const assets = editorGraph.assets;
  if (assets === undefined || (Array.isArray(assets) && assets.length === 0)) {
    return [];
  }
  return [
    {
      code: SubmissionFindingCode.ASSET_UNSUPPORTED,
      severity: SubmissionFindingSeverity.ERROR,
      message: 'The frozen workflow references assets, which this release does not support',
      details: { count: Array.isArray(assets) ? assets.length : 0 },
    },
  ];
}

// A fixed pattern set, deliberately not an entropy heuristic: that would flag every base64
// blob and every long identifier.
// Severity follows how certain the shape is: a PEM block or a three-segment JWT is a
// credential or nothing; the looser two read ordinary text often enough that an Admin judges.
const CREDENTIAL_PATTERNS: { rule: string; pattern: RegExp; severity: Finding['severity'] }[] = [
  {
    rule: 'PEM_PRIVATE_KEY',
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
    severity: SubmissionFindingSeverity.ERROR,
  },
  {
    rule: 'JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
    severity: SubmissionFindingSeverity.ERROR,
  },
  {
    rule: 'BEARER_TOKEN',
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]{16,}=*/,
    severity: SubmissionFindingSeverity.WARNING,
  },
  // Named parameters only, so an ordinary `?id=` is not a presigned URL.
  {
    rule: 'SIGNED_URL_PARAMETER',
    pattern: /[?&](?:X-Amz-Signature|X-Goog-Signature|AWSAccessKeyId|Signature|sig)=/i,
    severity: SubmissionFindingSeverity.WARNING,
  },
];

type Finding = SubmissionScanFindingType;

type ScanLocation = { nodeId: string; path: string; value: string };

// Rule group 5 of spec section 10, credential rule. A finding names the rule and where it
// fired, never the matched text: `scanResult` is stored and must not hold secrets.
export function buildEmbeddedCredentialFindings(
  editorGraph: Prisma.JsonObject,
): SubmissionScanFindingType[] {
  const findings: SubmissionScanFindingType[] = [];

  for (const location of collectPublisherStrings(editorGraph)) {
    const matched = CREDENTIAL_PATTERNS.find(({ pattern }) => pattern.test(location.value));
    if (!matched) {
      continue;
    }
    findings.push({
      code: SubmissionFindingCode.EMBEDDED_CREDENTIAL,
      severity: matched.severity,
      message: 'Node content contains what looks like a credential or signed URL',
      nodeId: location.nodeId,
      details: { rule: matched.rule, path: location.path },
    });
    if (findings.length >= SUBMISSION_SCAN_MAX_CREDENTIAL_FINDINGS) {
      break;
    }
  }

  return findings;
}

function collectPublisherStrings(editorGraph: Prisma.JsonObject): ScanLocation[] {
  const nodes = Array.isArray(editorGraph.nodes) ? editorGraph.nodes : [];
  const locations: ScanLocation[] = [];

  for (const node of nodes) {
    if (node === null || Array.isArray(node) || typeof node !== 'object') {
      continue;
    }
    const nodeId = typeof node.id === 'string' ? node.id : '';
    collectStrings(node.config, 'config', nodeId, locations);

    // Only a literal binding carries typed text; other kinds reference something by name.
    const bindings = node.bindings;
    if (bindings === null || Array.isArray(bindings) || typeof bindings !== 'object') {
      continue;
    }
    for (const [field, binding] of Object.entries(bindings)) {
      if (binding === null || Array.isArray(binding) || typeof binding !== 'object') {
        continue;
      }
      collectStrings(binding.value, `bindings.${field}.value`, nodeId, locations);
    }
  }

  return locations;
}

function collectStrings(
  value: Prisma.JsonValue | undefined,
  path: string,
  nodeId: string,
  into: ScanLocation[],
): void {
  if (typeof value === 'string') {
    into.push({ nodeId, path, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, at) => collectStrings(item, `${path}.${at}`, nodeId, into));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      collectStrings(nested, `${path}.${key}`, nodeId, into);
    }
  }
}
