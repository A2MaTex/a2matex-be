import { PROJECT_DRAFT_MAX_CONTENT_BYTES } from '../../../shared/constants/project.constant.ts';
import { prepareProjectDraftContent } from '../project-draft.util.ts';

function draft(overrides: Record<string, unknown> = {}) {
  return {
    expectedVersion: 0,
    editorGraph: {},
    inputSchema: {},
    runtimeIr: null,
    validationSummary: {},
    testSummary: {},
    ...overrides,
  };
}

describe('Project Draft canonical content', () => {
  it('produces the same hash for objects with different key order', () => {
    const first = prepareProjectDraftContent(
      draft({ editorGraph: { z: 1, nested: { b: true, a: false } } }),
    );
    const second = prepareProjectDraftContent(
      draft({ editorGraph: { nested: { a: false, b: true }, z: 1 } }),
    );

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves array order when hashing', () => {
    const first = prepareProjectDraftContent(draft({ editorGraph: { nodes: [1, 2] } }));
    const second = prepareProjectDraftContent(draft({ editorGraph: { nodes: [2, 1] } }));

    expect(first.contentHash).not.toBe(second.contentHash);
  });

  it('rejects canonical content larger than 1 MiB', () => {
    expect(() =>
      prepareProjectDraftContent(
        draft({ editorGraph: { value: 'x'.repeat(PROJECT_DRAFT_MAX_CONTENT_BYTES) } }),
      ),
    ).toThrow('Error.ProjectDraftPayloadTooLarge');
  });
});
