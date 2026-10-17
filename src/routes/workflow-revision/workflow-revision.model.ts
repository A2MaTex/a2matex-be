import type { Prisma } from '../../generated/prisma/client.ts';
import type { ProjectStatusType } from '../../shared/constants/project.constant.ts';
import type { ProjectAccess } from '../project/project-access.model.ts';

export type CreateWorkflowRevisionInput = {
  projectId: string;
  sourceDraftVersion: number;
  createdById: string;
  access: ProjectAccess;
};

export type CreateWorkflowRevisionOutput = {
  id: string;
  projectId: string;
  sourceDraftVersion: number;
  sourceDraftContentHash: string;
  contentHash: string;
};

export type LockedWorkflowRevisionProject = {
  status: ProjectStatusType;
};

export type LockedWorkflowRevisionDraft = {
  version: number;
  editorGraph: Prisma.JsonValue;
  inputSchema: Prisma.JsonValue;
  runtimeIr: Prisma.JsonValue | null;
  validationSummary: Prisma.JsonValue;
  testSummary: Prisma.JsonValue;
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
  supportedErrorPolicies: Prisma.JsonValue;
  contentHash: string;
  NodeDefinitionCapability: Array<{
    Capability: { code: string };
  }>;
};

export type WorkflowRevisionSnapshot = {
  editorGraph: Prisma.JsonObject;
  runtimeIr: Prisma.JsonObject;
  inputSchema: Prisma.JsonObject;
  nodeDefinitionManifest: Prisma.JsonObject;
  capabilityManifest: Prisma.JsonObject;
  validationSummary: Prisma.JsonObject;
  testSummary: Prisma.JsonObject;
  contentHash: string;
};
