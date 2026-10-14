import { createHash } from 'node:crypto';
import type { SaveProjectDraftInputType } from './project-draft.model.ts';
import { ProjectDraftPayloadTooLargeException } from './project-draft.error.ts';
import { PROJECT_DRAFT_MAX_CONTENT_BYTES } from '../../shared/constants/project.constant.ts';

type CanonicalJsonValue =
  null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

function canonicalizeJson(value: CanonicalJsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function prepareProjectDraftContent(data: SaveProjectDraftInputType) {
  const canonicalContent = canonicalizeJson({
    editorGraph: data.editorGraph,
    inputSchema: data.inputSchema,
    runtimeIr: data.runtimeIr,
    validationSummary: data.validationSummary,
    testSummary: data.testSummary,
  });

  if (Buffer.byteLength(canonicalContent, 'utf8') > PROJECT_DRAFT_MAX_CONTENT_BYTES) {
    throw ProjectDraftPayloadTooLargeException;
  }

  return {
    contentHash: createHash('sha256').update(canonicalContent).digest('hex'),
    content: {
      editorGraph: data.editorGraph,
      inputSchema: data.inputSchema,
      runtimeIr: data.runtimeIr,
      validationSummary: data.validationSummary,
      testSummary: data.testSummary,
    },
  };
}
