import { createHash } from 'node:crypto';
import type { SaveProjectDraftInputType } from './project-draft.model.ts';
import { ProjectDraftPayloadTooLargeException } from './project-draft.error.ts';
import { PROJECT_DRAFT_MAX_CONTENT_BYTES } from '../../shared/constants/project.constant.ts';

type ProjectDraftHashContent = {
  editorGraph: unknown;
  inputSchema: unknown;
  runtimeIr: unknown;
  validationSummary: unknown;
  testSummary: unknown;
};

function canonicalizeJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) as string;
}

export function prepareProjectDraftContent(data: SaveProjectDraftInputType) {
  const content = {
    editorGraph: data.editorGraph,
    inputSchema: data.inputSchema,
    runtimeIr: data.runtimeIr,
    validationSummary: data.validationSummary,
    testSummary: data.testSummary,
  };
  const canonicalContent = canonicalizeProjectDraftContent(content);

  if (Buffer.byteLength(canonicalContent, 'utf8') > PROJECT_DRAFT_MAX_CONTENT_BYTES) {
    throw ProjectDraftPayloadTooLargeException;
  }

  return {
    contentHash: createHash('sha256').update(canonicalContent).digest('hex'),
    content,
  };
}

export function calculateProjectDraftContentHash(data: ProjectDraftHashContent): string {
  return createHash('sha256').update(canonicalizeProjectDraftContent(data)).digest('hex');
}

function canonicalizeProjectDraftContent(data: ProjectDraftHashContent): string {
  return canonicalizeJson({
    editorGraph: data.editorGraph,
    inputSchema: data.inputSchema,
    runtimeIr: data.runtimeIr,
    validationSummary: data.validationSummary,
    testSummary: data.testSummary,
  });
}
