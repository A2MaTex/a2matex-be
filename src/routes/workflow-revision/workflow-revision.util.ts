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
  WorkflowRevisionSnapshot,
} from './workflow-revision.model.ts';

export function requireJsonObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw WorkflowRevisionSourceIntegrityFailedException;
  }
  return value;
}

export function extractWorkflowNodeTypes(editorGraph: Prisma.JsonObject): string[] {
  const nodes = editorGraph.nodes;
  if (!Array.isArray(nodes)) {
    throw WorkflowRevisionSourceIntegrityFailedException;
  }

  const nodeTypes = new Set<string>();
  for (const node of nodes) {
    if (
      node === null ||
      Array.isArray(node) ||
      typeof node !== 'object' ||
      typeof node.type !== 'string' ||
      node.type.length === 0
    ) {
      throw WorkflowRevisionSourceIntegrityFailedException;
    }
    nodeTypes.add(node.type);
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

export function prepareWorkflowRevisionSnapshot({
  draft,
  definitions,
}: {
  draft: LockedWorkflowRevisionDraft;
  definitions: WorkflowRevisionNodeDefinition[];
}): WorkflowRevisionSnapshot {
  const editorGraph = requireJsonObject(draft.editorGraph);
  const runtimeIr = requireJsonObject(draft.runtimeIr);
  const inputSchema = requireJsonObject(draft.inputSchema);
  const validationSummary = requireJsonObject(draft.validationSummary);
  const testSummary = requireJsonObject(draft.testSummary);

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
      supportedErrorPolicies: requireJsonObject(definition.supportedErrorPolicies),
      capabilityCodes: [
        ...new Set(definition.NodeDefinitionCapability.map(({ Capability }) => Capability.code)),
      ].sort(),
      contentHash: definition.contentHash,
    }))
    .sort((left, right) => (left.type < right.type ? -1 : left.type > right.type ? 1 : 0));

  const capabilityManifest = {
    schemaVersion: WORKFLOW_REVISION_CAPABILITY_MANIFEST_VERSION,
    capabilities: [
      ...new Set(frozenDefinitions.flatMap((definition) => definition.capabilityCodes)),
    ].sort(),
  };
  const nodeDefinitionManifest = {
    schemaVersion: WORKFLOW_REVISION_NODE_MANIFEST_VERSION,
    definitions: frozenDefinitions,
  };

  const hashEnvelope = {
    hashVersion: WORKFLOW_REVISION_HASH_VERSION,
    editorGraph,
    runtimeIr,
    inputSchema,
    nodeDefinitionManifest,
    capabilityManifest,
    validationSummary,
    testSummary,
    assets: [],
  };

  if (
    Buffer.byteLength(canonicalJson(hashEnvelope), 'utf8') > WORKFLOW_REVISION_MAX_CONTENT_BYTES
  ) {
    throw WorkflowRevisionPayloadTooLargeException;
  }

  return {
    editorGraph,
    runtimeIr,
    inputSchema,
    nodeDefinitionManifest,
    capabilityManifest,
    validationSummary,
    testSummary,
    contentHash: sha256Hex(hashEnvelope),
  };
}
