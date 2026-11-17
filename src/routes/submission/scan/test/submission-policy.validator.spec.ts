import { SubmissionFindingCode } from '../../../../shared/constants/submission.constant.ts';
import { findUnsupportedAssets } from '../scanner/submission-policy.validator.ts';

describe('findUnsupportedAssets', () => {
  it('accepts a graph with no asset key and one with an empty list', () => {
    expect(findUnsupportedAssets({ nodes: [] })).toEqual([]);
    expect(findUnsupportedAssets({ nodes: [], assets: [] })).toEqual([]);
  });

  it('reports an asset-bearing graph with a bounded count', () => {
    const [finding] = findUnsupportedAssets({
      nodes: [],
      assets: [{ alias: 'private-input' }, { alias: 'other' }],
    });

    expect(finding?.code).toBe(SubmissionFindingCode.ASSET_UNSUPPORTED);
    expect(finding?.details).toEqual({ count: 2 });
    expect(JSON.stringify(finding)).not.toContain('private-input');
  });
});
