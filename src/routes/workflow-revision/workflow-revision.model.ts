import type { Prisma } from '../../generated/prisma/client.ts';
import type { ProjectStatusType } from '../../shared/constants/project.constant.ts';
import type { ProjectAccess } from '../../shared/models/project-access.model.ts';

export type CreateWorkflowRevisionInput = {
  projectId: string;
  sourceDraftVersion: number;
  createdById: string;
  access: ProjectAccess;
};

// No `contentHash`: a freshly created revision has none until the scan compiles it.
export type CreateWorkflowRevisionOutput = {
  id: string;
  projectId: string;
  sourceDraftVersion: number;
  sourceDraftContentHash: string;
};

export type LockedWorkflowRevisionProject = {
  status: ProjectStatusType;
};

// `runtimeIr` is deliberately absent: an authoring cache the revision must not read.
export type LockedWorkflowRevisionDraft = {
  version: number;
  editorGraph: Prisma.JsonValue;
  inputSchema: Prisma.JsonValue;
  validationSummary: Prisma.JsonValue;
  contentHash: string;
};

export type WorkflowRevisionNodeDefinition = {
  type: string;
  name: string;
  description: string;
  category: string;
  runtimeHandler: string;
  minimumRuntimeVersion: string;
  defaultTimeoutMs: number;
  configSchema: Prisma.JsonValue;
  inputSchema: Prisma.JsonValue;
  outputSchema: Prisma.JsonValue;
  outputPorts: Prisma.JsonValue;
  editorHints: Prisma.JsonValue;
  contentHash: string;
  NodeDefinitionCapability: Array<{
    Capability: { code: string };
  }>;
};

// What the HTTP transaction freezes; the scan writes `runtimeIr` and `contentHash` later.
export type WorkflowRevisionSourceSnapshot = {
  editorGraph: Prisma.JsonObject;
  inputSchema: Prisma.JsonObject;
  nodeDefinitionManifest: Prisma.JsonObject;
  capabilityManifest: Prisma.JsonObject;
  validationSummary: Prisma.JsonObject;
};
