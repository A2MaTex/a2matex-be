import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import { ProductReleaseStatus } from '../../shared/constants/product-release.constant.ts';
import type { ProductReleaseStatusType } from '../../shared/constants/product-release.constant.ts';
import { ReleaseRequestSnapshot } from '../../entities/submission.model.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { buildProductAccessWhere, type ProductAccess } from '../product/product-access.model.ts';
import type {
  GetProductReleaseListInputType,
  GetProductReleaseListOutputType,
  ProductReleaseDetailOutputType,
  ProductReleaseSummaryOutputType,
} from './product-release.model.ts';

export type LockedProduct = {
  id: string;
  status: ProductStatusType;
  currentReleaseId: string | null;
};

export type LockedProductRelease = {
  id: string;
  status: ProductReleaseStatusType;
  packageStaticId: string | null;
  packageHash: string | null;
  disabledAt: Date | null;
  disabledReason: string | null;
};

const RELEASE_SUMMARY_SELECT = {
  id: true,
  productId: true,
  submissionId: true,
  version: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  buildFailureCode: true,
  submission: {
    select: {
      workflowRevisionId: true,
      releaseRequest: true,
    },
  },
} satisfies Prisma.ProductReleaseSelect;

type ReleaseSummaryRow = Prisma.ProductReleaseGetPayload<{ select: typeof RELEASE_SUMMARY_SELECT }>;

@Injectable()
export class ProductReleaseManagementRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  // Reads: the visible Product is the authorization boundary for its Releases.
  getVisibleProduct({ id, access }: { id: string; access: ProductAccess }) {
    return this.prisma.product.findFirst({
      where: { id, ...buildProductAccessWhere(access) },
      select: { id: true, currentReleaseId: true },
    });
  }

  async getList({
    productId,
    currentReleaseId,
    query,
  }: {
    productId: string;
    currentReleaseId: string | null;
    query: GetProductReleaseListInputType;
  }): Promise<GetProductReleaseListOutputType> {
    const { page, limit, skip, take } = getPagination(query);
    const where = { productId } satisfies Prisma.ProductReleaseWhereInput;

    const [totalItems, releases] = await Promise.all([
      this.prisma.productRelease.count({ where }),
      this.prisma.productRelease.findMany({
        where,
        select: RELEASE_SUMMARY_SELECT,
        orderBy: [
          { publishedAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip,
        take,
      }),
    ]);

    return {
      items: releases.map((release) => this.toSummary(release, currentReleaseId)),
      totalItems,
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  async getDetail({
    productId,
    releaseId,
    currentReleaseId,
    includeFailureCode,
  }: {
    productId: string;
    releaseId: string;
    currentReleaseId: string | null;
    includeFailureCode: boolean;
  }): Promise<ProductReleaseDetailOutputType | null> {
    const release = await this.prisma.productRelease.findFirst({
      where: { id: releaseId, productId },
      select: {
        ...RELEASE_SUMMARY_SELECT,
        packageStaticId: true,
        packageHash: true,
        disabledAt: true,
        disabledReason: true,
        buildFailureCode: true,
        submission: {
          select: {
            workflowRevisionId: true,
            releaseRequest: true,
            WorkflowRevision: {
              select: { runtimeIr: true, inputSchema: true },
            },
          },
        },
      },
    });
    if (!release) {
      return null;
    }

    // Static has no relation on ProductRelease. Only the size is read, never id or key.
    const packageStatic = release.packageStaticId
      ? await this.prisma.static.findUnique({
          where: { id: release.packageStaticId },
          select: { size: true },
        })
      : null;

    const { runtimeIr, inputSchema } = release.submission.WorkflowRevision;
    const requiredCapabilities = (runtimeIr as { requiredCapabilities?: unknown })
      .requiredCapabilities;

    return {
      ...this.toSummary(release, currentReleaseId),
      workflowRevisionId: release.submission.workflowRevisionId,
      packageSizeBytes: packageStatic ? packageStatic.size.toString() : null,
      packageHash: release.packageHash,
      requiredCapabilities: Array.isArray(requiredCapabilities)
        ? requiredCapabilities.filter((item): item is string => typeof item === 'string')
        : [],
      inputSchema,
      disabledAt: release.disabledAt,
      disabledReason: release.disabledReason,
      ...(includeFailureCode ? { buildFailureCode: release.buildFailureCode } : {}),
    };
  }

  // Mutations. These must run inside one transaction in the order Product, target
  // ProductRelease, then the current/replacement ProductRelease.
  async lockProduct({
    id,
    access,
  }: {
    id: string;
    access: ProductAccess;
  }): Promise<LockedProduct | null> {
    const ownerFilter = access.unrestricted
      ? Prisma.empty
      : Prisma.sql`AND "publisherAccountId" = ${access.publisherAccountId}::uuid`;
    const rows = await this.prisma.$queryRaw<LockedProduct[]>`
      SELECT id, status, "currentReleaseId"
      FROM "Product"
      WHERE id = ${id}::uuid
        AND "deletedAt" IS NULL
        ${ownerFilter}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async lockRelease({
    id,
    productId,
  }: {
    id: string;
    productId: string;
  }): Promise<LockedProductRelease | null> {
    const rows = await this.prisma.$queryRaw<LockedProductRelease[]>`
      SELECT id, status, "packageStaticId", "packageHash", "disabledAt", "disabledReason"
      FROM "ProductRelease"
      WHERE id = ${id}::uuid
        AND "productId" = ${productId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  // Only the pointer and audit fields change; status is deliberately left alone so a
  // suspended Product is never reactivated by a selection.
  setCurrentRelease({
    productId,
    currentReleaseId,
    userId,
  }: {
    productId: string;
    currentReleaseId: string | null;
    userId: string;
  }) {
    return this.prisma.product.update({
      where: { id: productId },
      data: { currentReleaseId, updatedById: userId, updatedAt: new Date() },
      select: { id: true },
    });
  }

  async disable({
    id,
    reason,
    userId,
  }: {
    id: string;
    reason: string;
    userId: string;
  }): Promise<number> {
    const now = new Date();
    const { count } = await this.prisma.productRelease.updateMany({
      where: { id, status: ProductReleaseStatus.PUBLISHED },
      data: {
        status: ProductReleaseStatus.DISABLED,
        disabledAt: now,
        disabledReason: reason,
        updatedAt: now,
        updatedById: userId,
      },
    });
    return count;
  }

  private toSummary(
    release: ReleaseSummaryRow,
    currentReleaseId: string | null,
  ): ProductReleaseSummaryOutputType {
    const { changelog, minimumLauncherVersion, minimumRuntimeVersion } =
      ReleaseRequestSnapshot.parse(release.submission.releaseRequest);
    return {
      id: release.id,
      productId: release.productId,
      submissionId: release.submissionId,
      version: release.version,
      status: release.status,
      buildFailureCode: release?.buildFailureCode || '',
      changelog,
      minimumLauncherVersion,
      minimumRuntimeVersion,
      publishedAt: release.publishedAt,
      createdAt: release.createdAt,
      isCurrent: release.id === currentReleaseId,
    };
  }
}
