import { sha256Hex } from '../node-catalog/node-catalog.util.ts';
import {
  ProductSubmissionSnapshot,
  ReleaseRequestSnapshot,
  SubmissionReviewContextSnapshot,
  type ProductSubmissionSnapshotType,
  type ReleaseRequestSnapshotType,
  type SubmissionReviewContextSnapshotType,
} from '../../entities/submission.model.ts';
import { ProductMediaType } from '../../shared/constants/product.constant.ts';
import {
  SUBMISSION_SNAPSHOT_SCHEMA_VERSION,
  SubmissionScanStatus,
  type SubmissionScanStatusType,
} from '../../shared/constants/submission.constant.ts';
import type {
  CreateSubmissionInputType,
  ReleaseRequestInputType,
  SubmissionReviewContextInputType,
} from './submission.model.ts';
import { SubmissionProductIncompleteException } from './submission.error.ts';
import type { LockedSubmissionProduct, SubmissionProductMedia } from './submission.repo.ts';

// Detects an Idempotency-Key replayed with different input. Key order is canonical,
// so only a real content change produces a different digest.
export function calculateSubmissionRequestHash(data: CreateSubmissionInputType): string {
  return sha256Hex({
    productId: data.productId,
    sourceDraftVersion: data.sourceDraftVersion,
    releaseRequest: data.releaseRequest,
    reviewContext: data.reviewContext,
  });
}

export function buildProductSnapshot({
  product,
  media,
}: {
  product: LockedSubmissionProduct;
  media: SubmissionProductMedia[];
}): ProductSubmissionSnapshotType {
  const { name, slug, shortDescription, description } = product;
  if (!name || !slug || !shortDescription || !description) {
    throw SubmissionProductIncompleteException;
  }
  if (countMediaOfType(media, ProductMediaType.ICON) > 1) {
    throw SubmissionProductIncompleteException;
  }
  if (countMediaOfType(media, ProductMediaType.COVER) > 1) {
    throw SubmissionProductIncompleteException;
  }

  return ProductSubmissionSnapshot.parse({
    schemaVersion: SUBMISSION_SNAPSHOT_SCHEMA_VERSION,
    productId: product.id,
    publisherAccountId: product.publisherAccountId,
    projectId: product.projectId,
    name,
    slug,
    shortDescription,
    description,
    usageInstructions: product.usageInstructions,
    media,
  });
}

export function buildReleaseRequestSnapshot(
  data: ReleaseRequestInputType,
): ReleaseRequestSnapshotType {
  return ReleaseRequestSnapshot.parse({
    schemaVersion: SUBMISSION_SNAPSHOT_SCHEMA_VERSION,
    ...data,
  });
}

export function buildReviewContextSnapshot(
  data: SubmissionReviewContextInputType,
): SubmissionReviewContextSnapshotType {
  return SubmissionReviewContextSnapshot.parse({
    schemaVersion: SUBMISSION_SNAPSHOT_SCHEMA_VERSION,
    ...data,
  });
}

// A replay only republishes while the durable scan request is still unclaimed.
export function isRepublishableScanStatus(status: SubmissionScanStatusType): boolean {
  return status === SubmissionScanStatus.QUEUED;
}

function countMediaOfType(media: SubmissionProductMedia[], type: string): number {
  return media.filter((item) => item.type === type).length;
}
