import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import type {
  SubmissionScanStatusType,
  SubmissionStatusType,
} from '../../shared/constants/submission.constant.ts';
import { SubmissionStatus } from '../../shared/constants/submission.constant.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type { SubmissionAccess, SubmissionListFilter } from './submission-access.model.ts';
import { AdminSubmissionListItem } from './submission.model.ts';
import type {
  AdminSubmissionListItemType,
  GetSubmissionListInputType,
  SubmissionListItemType,
} from './submission.model.ts';

export type LockedSubmissionProduct = {
  id: string;
  publisherAccountId: string;
  projectId: string;
  status: ProductStatusType;
  name: string | null;
  slug: string | null;
  shortDescription: string | null;
  description: string | null;
  usageInstructions: string | null;
};

export type SubmissionProductMedia = {
  id: string;
  staticId: string;
  type: 'ICON' | 'COVER' | 'GALLERY';
  sortOrder: number;
  altText: string | null;
};

export type ExistingIdempotentSubmission = {
  id: string;
  requestHash: string;
  scanAttempt: number;
  scanStatus: SubmissionScanStatusType;
  createdAt: Date;
  updatedAt: Date | null;
};

export type CreatedSubmission = {
  id: string;
  scanAttempt: number;
  createdAt: Date;
};

export type CreateSubmissionRecord = {
  productId: string;
  workflowRevisionId: string;
  number: number;
  productSnapshot: Prisma.InputJsonValue;
  releaseRequest: Prisma.InputJsonValue;
  reviewContext: Prisma.InputJsonValue;
  idempotencyKey: string;
  requestHash: string;
  createdById: string;
};

// A Submission is open while it still expects a decision; only one may exist per Product.
const OPEN_SUBMISSION_STATUSES: SubmissionStatusType[] = [
  SubmissionStatus.PENDING_SCAN,
  SubmissionStatus.READY_FOR_REVIEW,
];

type ListRow = {
  id: string;
  productId: string;
  workflowRevisionId: string;
  number: number;
  status: SubmissionStatusType;
  productName: string;
  productSlug: string;
  iconStaticId: string | null;
  requestedVersion: string;
  createdAt: Date;
  updatedAt: Date | null;
  createdById: string;
};

type AdminListRow = ListRow & {
  scanAttempt: number;
  scanStatus: SubmissionScanStatusType;
  scannerVersion: string | null;
  scanSummary: unknown;
};

// Only the four presentation values are pulled out of the snapshot. Selecting the
// whole JSONB would drag an unbounded Product description through every list row.
const LIST_COLUMNS = Prisma.sql`
  s.id,
  s."productId",
  s."workflowRevisionId",
  s.number,
  s.status,
  s."productSnapshot" ->> 'name' AS "productName",
  s."productSnapshot" ->> 'slug' AS "productSlug",
  (
    SELECT media ->> 'staticId'
    FROM jsonb_array_elements(s."productSnapshot" -> 'media') AS media
    WHERE media ->> 'type' = 'ICON'
    LIMIT 1
  ) AS "iconStaticId",
  s."releaseRequest" ->> 'version' AS "requestedVersion",
  s."createdAt",
  s."updatedAt",
  s."createdById"
`;

const ADMIN_SCAN_COLUMNS = Prisma.sql`
  s."scanAttempt",
  s."scanStatus",
  s."scannerVersion",
  s."scanResult" -> 'summary' AS "scanSummary"
`;

// A summary written by anything that skipped the entity schema must not take the
// whole Admin page down with a serialization failure.
function toScanSummary(value: unknown): AdminSubmissionListItemType['scanSummary'] {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = AdminSubmissionListItem.shape.scanSummary.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toListItem(row: ListRow): SubmissionListItemType {
  return {
    id: row.id,
    productId: row.productId,
    workflowRevisionId: row.workflowRevisionId,
    number: row.number,
    status: row.status,
    product: {
      name: row.productName,
      slug: row.productSlug,
      iconStaticId: row.iconStaticId,
    },
    requestedVersion: row.requestedVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
  };
}

@Injectable()
export class SubmissionRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  getPublisherAccount(userId: string) {
    return this.prisma.publisherAccount.findFirst({
      where: {
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  // Claimed before any snapshot work so a replayed key never rebuilds a revision.
  findByIdempotencyKey({
    createdById,
    idempotencyKey,
  }: {
    createdById: string;
    idempotencyKey: string;
  }): Promise<ExistingIdempotentSubmission | null> {
    return this.prisma.submission.findFirst({
      where: {
        createdById,
        idempotencyKey,
      },
      select: {
        id: true,
        requestHash: true,
        scanAttempt: true,
        scanStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // First lock of the documented order Product -> Project -> ProjectDraft -> latest
  // Submission. It serialises per-Product number allocation and the open-Submission
  // check, so neither needs its own database constraint.
  async lockOwnedProduct({
    productId,
    publisherAccountId,
  }: {
    productId: string;
    publisherAccountId: string;
  }): Promise<LockedSubmissionProduct | null> {
    const products = await this.prisma.$queryRaw<LockedSubmissionProduct[]>`
      SELECT
        id,
        "publisherAccountId",
        "projectId",
        status,
        name,
        slug,
        "shortDescription",
        description,
        "usageInstructions"
      FROM "Product"
      WHERE id = ${productId}::uuid
        AND "publisherAccountId" = ${publisherAccountId}::uuid
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    return products[0] ?? null;
  }

  // Ordering matches the Product contract so the frozen snapshot and the mutable
  // Product read present media in the same sequence.
  getProductMedia(productId: string): Promise<SubmissionProductMedia[]> {
    return this.prisma.productMedia.findMany({
      where: {
        productId,
        deletedAt: null,
      },
      select: {
        id: true,
        staticId: true,
        type: true,
        sortOrder: true,
        altText: true,
      },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  // Soft-deleted rows stay in scope because UNIQUE("productId", number) has no
  // deletedAt predicate: skipping them would re-allocate a number the index holds.
  async getNextSubmissionNumber(productId: string): Promise<number> {
    const latest = await this.prisma.submission.findFirst({
      where: { productId },
      select: { number: true },
      orderBy: { number: 'desc' },
    });
    return (latest?.number ?? 0) + 1;
  }

  // Asked over every live row rather than only the newest one. Reading just the
  // highest number would miss an older open Submission once anything soft-deletes a
  // newer row, and no database constraint backs this rule.
  findOpenSubmission(productId: string): Promise<{ id: string } | null> {
    return this.prisma.submission.findFirst({
      where: {
        productId,
        deletedAt: null,
        status: { in: OPEN_SUBMISSION_STATUSES },
      },
      select: { id: true },
    });
  }

  // Two statements rather than one projection: an OWN caller's query must never put
  // a scan column in its SELECT list, not merely drop it before responding.
  async getOwnerList({
    query,
    access,
  }: {
    query: GetSubmissionListInputType;
    access: SubmissionAccess;
  }) {
    const { page, limit, skip, take } = getPagination(query);
    const where = buildListWhere(access, query);
    const [totalItems, rows] = await Promise.all([
      this.countList(where),
      this.prisma.$queryRaw<ListRow[]>`
        SELECT ${LIST_COLUMNS}
        FROM "Submission" s
        JOIN "Product" p ON p.id = s."productId"
        WHERE ${where}
        ORDER BY s."createdAt" DESC, s.id DESC
        LIMIT ${take} OFFSET ${skip}
      `,
    ]);
    return { items: rows.map(toListItem), totalItems, page, limit };
  }

  async getAdminList({
    query,
    access,
  }: {
    query: GetSubmissionListInputType;
    access: SubmissionAccess;
  }) {
    const { page, limit, skip, take } = getPagination(query);
    const where = buildListWhere(access, query);
    const [totalItems, rows] = await Promise.all([
      this.countList(where),
      this.prisma.$queryRaw<AdminListRow[]>`
        SELECT ${LIST_COLUMNS}, ${ADMIN_SCAN_COLUMNS}
        FROM "Submission" s
        JOIN "Product" p ON p.id = s."productId"
        WHERE ${where}
        ORDER BY s."createdAt" DESC, s.id DESC
        LIMIT ${take} OFFSET ${skip}
      `,
    ]);
    const items: AdminSubmissionListItemType[] = rows.map((row) => ({
      ...toListItem(row),
      scanAttempt: row.scanAttempt,
      scanStatus: row.scanStatus,
      scannerVersion: row.scannerVersion,
      scanSummary: toScanSummary(row.scanSummary),
    }));
    return { items, totalItems, page, limit };
  }

  private async countList(where: Prisma.Sql): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM "Submission" s
      JOIN "Product" p ON p.id = s."productId"
      WHERE ${where}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  // createdAt and scanAttempt feed the queue envelope; only `id` reaches the client.
  create(data: CreateSubmissionRecord): Promise<CreatedSubmission> {
    return this.prisma.submission.create({
      data,
      select: { id: true, scanAttempt: true, createdAt: true },
    });
  }
}

// Ownership is never stored on Submission; an OWN caller reaches rows only through
// the Product join.
function buildListWhere(access: SubmissionAccess, filter: SubmissionListFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`s."deletedAt" IS NULL`,
    Prisma.sql`p."deletedAt" IS NULL`,
  ];
  if (!access.unrestricted) {
    conditions.push(Prisma.sql`p."publisherAccountId" = ${access.publisherAccountId}::uuid`);
  }
  if (filter.status) {
    conditions.push(Prisma.sql`s.status = ${filter.status}::"SubmissionStatus"`);
  }
  if (filter.productId) {
    conditions.push(Prisma.sql`s."productId" = ${filter.productId}::uuid`);
  }
  return Prisma.join(conditions, ' AND ');
}
