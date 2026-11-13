import type { Prisma } from '../../generated/prisma/client.ts';
import { canonicalJson, sha256Hex } from '../node-catalog/node-catalog.util.ts';
import {
  WORKFLOW_REVISION_CAPABILITY_MANIFEST_VERSION,
  WORKFLOW_REVISION_HASH_VERSION,
  WORKFLOW_REVISION_MAX_CONTENT_BYTES,
  WORKFLOW_REVISION_NODE_MANIFEST_VERSION,
} from './workflow-revision.constant.ts';
import {
  WorkflowRevisionAssetUnsupportedException,
  WorkflowRevisionPayloadTooLargeException,
  WorkflowRevisionSourceIntegrityFailedException,
} from './workflow-revision.error.ts';
import type {
  LockedWorkflowRevisionDraft,
  WorkflowRevisionNodeDefinition,
  WorkflowRevisionSourceSnapshot,
} from './workflow-revision.model.ts';

export function requireJsonObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw WorkflowRevisionSourceIntegrityFailedException;
  }
  return value;
}

// Tolerant on purpose: a malformed or unavailable node type is a scan finding rather than a
// refused freeze. What is skipped here stays in the frozen graph, so the scan still sees it.
export function extractWorkflowNodeTypes(editorGraph: Prisma.JsonObject): string[] {
  const nodes = Array.isArray(editorGraph.nodes) ? editorGraph.nodes : [];
  const nodeTypes = new Set<string>();

  for (const node of nodes) {
    if (
      node !== null &&
      !Array.isArray(node) &&
      typeof node === 'object' &&
      typeof node.type === 'string' &&
      node.type.length > 0
    ) {
      nodeTypes.add(node.type);
    }
  }

  return [...nodeTypes].sort();
}

export function requireAssetFreeWorkflow(editorGraph: Prisma.JsonObject): void {
  if (editorGraph.assets === undefined) {
    return;
  }
  if (!Array.isArray(editorGraph.assets)) {
    throw WorkflowRevisionSourceIntegrityFailedException;
  }
  if (editorGraph.assets.length > 0) {
    throw WorkflowRevisionAssetUnsupportedException;
  }
}

export type WorkflowRevisionHashContent = {
  editorGraph: Prisma.JsonObject;
  runtimeIr: Prisma.JsonObject;
  inputSchema: Prisma.JsonObject;
  nodeDefinitionManifest: Prisma.JsonObject;
  capabilityManifest: Prisma.JsonObject;
  validationSummary: Prisma.JsonObject;
};

// Canonical JSON sorts keys, so the envelope hashes the same whether it is built when the
// scan finalizes the revision or rebuilt from the stored columns to re-verify one.
function buildHashEnvelope(content: WorkflowRevisionHashContent) {
  return { hashVersion: WORKFLOW_REVISION_HASH_VERSION, ...content, assets: [] };
}

export function calculateWorkflowRevisionContentHash(content: WorkflowRevisionHashContent): string {
  return sha256Hex(buildHashEnvelope(content));
}

// The 2 MiB ceiling applies to the finalized document; the source freeze bounds the request.
export function finalizeWorkflowRevisionContentHash({
  source,
  runtimeIr,
}: {
  source: WorkflowRevisionSourceSnapshot;
  runtimeIr: Prisma.JsonObject;
}): string {
  const envelope = buildHashEnvelope({ ...source, runtimeIr });
  if (Buffer.byteLength(canonicalJson(envelope), 'utf8') > WORKFLOW_REVISION_MAX_CONTENT_BYTES) {
    throw WorkflowRevisionPayloadTooLargeException;
  }
  return sha256Hex(envelope);
}

export function prepareWorkflowRevisionSourceSnapshot({
  draft,
  definitions,
}: {
  draft: LockedWorkflowRevisionDraft;
  definitions: WorkflowRevisionNodeDefinition[];
}): WorkflowRevisionSourceSnapshot {
  const editorGraph = requireJsonObject(draft.editorGraph);
  const inputSchema = requireJsonObject(draft.inputSchema);
  const validationSummary = requireJsonObject(draft.validationSummary);

  const frozenDefinitions = definitions
    .map((definition) => ({
      type: definition.type,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      runtimeHandler: definition.runtimeHandler,
      minimumRuntimeVersion: definition.minimumRuntimeVersion,
      defaultTimeoutMs: definition.defaultTimeoutMs,
      configSchema: requireJsonObject(definition.configSchema),
      inputSchema: requireJsonObject(definition.inputSchema),
      outputSchema: requireJsonObject(definition.outputSchema),
      outputPorts: requireJsonObject(definition.outputPorts),
      editorHints: requireJsonObject(definition.editorHints),
      capabilityCodes: [
        ...new Set(definition.NodeDefinitionCapability.map(({ Capability }) => Capability.code)),
      ].sort(),
      contentHash: definition.contentHash,
    }))
    .sort((left, right) => (left.type < right.type ? -1 : left.type > right.type ? 1 : 0));

  const capabilityManifest = {
    schemaVersion: WORKFLOW_REVISION_CAPABILITY_MANIFEST_VERSION,
    capabilities: deriveRequiredCapabilities(editorGraph, frozenDefinitions),
  };
  const nodeDefinitionManifest = {
    schemaVersion: WORKFLOW_REVISION_NODE_MANIFEST_VERSION,
    definitions: frozenDefinitions,
  };

  const source: WorkflowRevisionSourceSnapshot = {
    editorGraph,
    inputSchema,
    nodeDefinitionManifest,
    capabilityManifest,
    validationSummary,
  };
  if (Buffer.byteLength(canonicalJson(source), 'utf8') > WORKFLOW_REVISION_MAX_CONTENT_BYTES) {
    throw WorkflowRevisionPayloadTooLargeException;
  }
  return source;
}

// Must reproduce the order the compiler builds `runtimeIr.requiredCapabilities` in, because
// the scan compares the two.
function deriveRequiredCapabilities(
  editorGraph: Prisma.JsonObject,
  definitions: { type: string; capabilityCodes: string[] }[],
): string[] {
  const codesByType = new Map(
    definitions.map(({ type, capabilityCodes }) => [type, capabilityCodes]),
  );
  const nodes = Array.isArray(editorGraph.nodes) ? editorGraph.nodes : [];
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const node of nodes) {
    const type =
      node !== null &&
      !Array.isArray(node) &&
      typeof node === 'object' &&
      typeof node.type === 'string'
        ? node.type
        : null;
    if (type === null) {
      continue;
    }
    for (const code of codesByType.get(type) ?? []) {
      if (seen.has(code)) {
        continue;
      }
      seen.add(code);
      ordered.push(code);
    }
  }
  return ordered;
}
