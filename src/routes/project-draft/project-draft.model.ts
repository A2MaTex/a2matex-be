import { z } from 'zod';
import { ProjectStatus } from '../../shared/constants/project.constant.ts';
import { zDate } from '../../shared/utils/zod.ts';

const ProjectDraftJsonObject = z.record(z.string(), z.json());

export const SaveProjectDraftInput = z
  .object({
    expectedVersion: z.number().int().nonnegative().safe(),
    editorGraph: ProjectDraftJsonObject,
    inputSchema: ProjectDraftJsonObject,
    runtimeIr: ProjectDraftJsonObject.nullable(),
    validationSummary: ProjectDraftJsonObject,
    testSummary: ProjectDraftJsonObject,
  })
  .strict();

export const ProjectDraftSyncOutput = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  savedAt: zDate(),
});

export const ProjectDraftOutput = ProjectDraftSyncOutput.extend({
  projectId: z.uuid(),
  editorGraph: ProjectDraftJsonObject,
  inputSchema: ProjectDraftJsonObject,
  runtimeIr: ProjectDraftJsonObject.nullable(),
  validationSummary: ProjectDraftJsonObject,
  testSummary: ProjectDraftJsonObject,
});

export const GetProjectDraftOutput = z.object({
  projectStatus: z.enum([ProjectStatus.ACTIVE, ProjectStatus.ARCHIVED]),
  draft: ProjectDraftOutput.nullable(),
});

export type SaveProjectDraftInputType = z.infer<typeof SaveProjectDraftInput>;
export type ProjectDraftSyncOutputType = z.infer<typeof ProjectDraftSyncOutput>;
export type ProjectDraftOutputType = z.infer<typeof ProjectDraftOutput>;
