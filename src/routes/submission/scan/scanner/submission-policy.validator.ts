import type { Prisma } from '../../../../generated/prisma/client.ts';
import type { SubmissionScanFindingType } from '../../../../entities/submission.model.ts';
import {
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
