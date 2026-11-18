import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import { ProjectStatus } from '../../shared/constants/project.constant.ts';
import { STATIC_IMAGE_OUTPUT_CONTENT_TYPE } from '../../shared/constants/storage.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { buildProductAccessWhere, type ProductAccess } from './product-access.model.ts';
import type {
  CreateProductInputType,
  CreateProductOutputType,
  GetProductListInputType,
  GetProductListOutputType,
  ProductDetailOutputType,
  ProductManagementOutputType,
  ProductMediaInputType,
  UpdateProductInputType,
} from './product.model.ts';

const PRODUCT_SELECT = {
  id: true,
  publisherAccountId: true,
  status: true,
  name: true,
  slug: true,
  shortDescription: true,
  description: true,
  usageInstructions: true,
  currentReleaseId: true,
  statusReason: true,
  suspendedAt: true,
  createdAt: true,
  updatedAt: true,
  Project: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  ProductMedia: {
    where: {
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
  },
} satisfies Prisma.ProductSelect;

// Canonical Offer order: type, then finite duration ascending, then permanent access.
const PRODUCT_DETAIL_SELECT = {
  ...PRODUCT_SELECT,
  ProductOffer: {
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
      type: true,
      priceAmount: true,
      durationDays: true,
    },
    orderBy: [{ type: 'asc' }, { durationDays: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  },
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

type ProductDetailRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_DETAIL_SELECT }>;

export type LockedProduct = {
  id: string;
  status: ProductStatusType;
  currentReleaseId: string | null;
  transactionNow: Date;
};

@Injectable()
export class ProductRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  findOwnedActiveProject({
    projectId,
    publisherAccountId,
  }: {
    projectId: string;
    publisherAccountId: string;
  }) {
    return this.prisma.project.findFirst({
      where: {
        id: projectId,
        publisherAccountId,
        status: ProjectStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
  }

  // Existence check for create: the status is all the service needs to pick the
  // right rejection, so the full management row is not read here.
  getByProjectId({
    projectId,
    publisherAccountId,
  }: {
    projectId: string;
    publisherAccountId: string;
  }): Promise<{ id: string; status: ProductStatusType } | null> {
    return this.prisma.product.findFirst({
      where: {
        projectId,
        publisherAccountId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  // Requiring a generated variant row is what proves the image went through the
  // image pipeline: the plain file upload stores the caller's raw mimetype, so a
  // .webp uploaded there would pass a contentType check on its own.
  countEligibleMedia(staticIds: string[]) {
    return this.prisma.static.count({
      where: {
        id: {
          in: staticIds,
        },
        deletedAt: null,
        contentType: STATIC_IMAGE_OUTPUT_CONTENT_TYPE,
        StaticImageVariant: {
          some: {},
        },
      },
    });
  }

  createWithMedia({
    data,
    publisherAccountId,
    userId,
  }: {
    data: CreateProductInputType;
    publisherAccountId: string;
    userId: string;
  }): Promise<CreateProductOutputType> {
    return this.prisma.product.create({
      data: {
        publisherAccountId,
        projectId: data.projectId,
        status: ProductStatus.DRAFT,
        name: data.name ?? null,
        slug: data.slug ?? null,
        shortDescription: data.shortDescription ?? null,
        description: data.description ?? null,
        usageInstructions: data.usageInstructions ?? null,
        createdById: userId,
        ...(data.media.length > 0
          ? {
              ProductMedia: {
                create: data.media.map((item) => ({
                  staticId: item.staticId,
                  type: item.type,
                  sortOrder: item.sortOrder,
                  altText: item.altText ?? null,
                })),
              },
            }
          : {}),
      },
      select: {
        id: true,
      },
    });
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

  async getById({
    id,
    access,
  }: {
    id: string;
    access: ProductAccess;
  }): Promise<ProductManagementOutputType | null> {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        ...buildProductAccessWhere(access),
      },
      select: PRODUCT_SELECT,
    });
    return product ? this.toManagementOutput(product) : null;
  }

  // Only the detail route pays for the Offer collection; the lifecycle paths call
  // getById for a status they already failed to update.
  async getDetailById({
    id,
    access,
  }: {
    id: string;
    access: ProductAccess;
  }): Promise<ProductDetailOutputType | null> {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        ...buildProductAccessWhere(access),
      },
      select: PRODUCT_DETAIL_SELECT,
    });
    return product ? this.toDetailOutput(product) : null;
  }

  async getList({
    query,
    access,
  }: {
    query: GetProductListInputType;
    access: ProductAccess;
  }): Promise<GetProductListOutputType> {
    const { page, limit, skip, take } = getPagination(query);
    const where = buildProductAccessWhere(access, query.status);

    const [totalItems, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        select: PRODUCT_SELECT,
        orderBy: [
          { updatedAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip,
        take,
      }),
    ]);

    return {
      items: products.map((product) => this.toManagementOutput(product)),
      totalItems,
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  // A zero count means no row matched, which the service turns into not-found,
  // archived or suspended through one ownership-safe read.
  async updateEditable({
    id,
    data,
    publisherAccountId,
    userId,
  }: {
    id: string;
    data: UpdateProductInputType;
    publisherAccountId: string;
    userId: string;
  }): Promise<{ count: number }> {
    const { media, ...fields } = data;

    const result = await this.prisma.product.updateMany({
      where: {
        id,
        publisherAccountId,
        deletedAt: null,
        status: {
          in: [ProductStatus.DRAFT, ProductStatus.ACTIVE],
        },
      },
      data: {
        ...fields,
        updatedById: userId,
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) {
      return result;
    }

    if (media !== undefined) {
      await this.replaceMedia({ productId: id, media });
    }

    return result;
  }

  // Lifecycle serializes on the Product row: readiness is validated and the status moves
  // inside one lock, so a Release disable or an Offer replacement cannot slip between.
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
    // Epoch milliseconds read the same whichever shape the driver returns.
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        status: ProductStatusType;
        currentReleaseId: string | null;
        transactionNowMs: bigint | number | string;
      }[]
    >`
      SELECT id, status, "currentReleaseId",
             (EXTRACT(EPOCH FROM now()) * 1000)::bigint AS "transactionNowMs"
      FROM "Product"
      WHERE id = ${id}::uuid
        AND "deletedAt" IS NULL
        ${ownerFilter}
      FOR UPDATE
    `;
    const row = rows[0];
    return (
      row && {
        id: row.id,
        status: row.status,
        currentReleaseId: row.currentReleaseId,
        transactionNow: new Date(Number(row.transactionNowMs)),
      }
    );
  }

  // The row is already locked and its source status checked, so these are plain writes.
  setStatus({ id, status, userId }: { id: string; status: ProductStatusType; userId: string }) {
    const now = new Date();
    return this.prisma.product.update({
      where: { id },
      data: {
        status,
        statusReason: null,
        suspendedAt: null,
        suspendedById: null,
        updatedById: userId,
        updatedAt: now,
      },
      select: { id: true },
    });
  }

  suspend({ id, userId, reason }: { id: string; userId: string; reason: string }) {
    const now = new Date();
    return this.prisma.product.update({
      where: { id },
      data: {
        status: ProductStatus.SUSPENDED,
        statusReason: reason,
        suspendedAt: now,
        suspendedById: userId,
        updatedById: userId,
        updatedAt: now,
      },
      select: { id: true },
    });
  }

  // Soft-delete first: the partial unique indexes only consider live rows, so
  // clearing them is what lets a previously removed image be attached again.
  archiveDraft({ id, access, userId }: { id: string; access: ProductAccess; userId: string }) {
    return this.prisma.product.updateMany({
      where: {
        id,
        ...buildProductAccessWhere(access, ProductStatus.DRAFT),
      },
      data: {
        status: ProductStatus.ARCHIVED,
        updatedById: userId,
        updatedAt: new Date(),
      },
    });
  }

  suspendActive({
    id,
    access,
    userId,
    reason,
  }: {
    id: string;
    access: ProductAccess;
    userId: string;
    reason: string;
  }) {
    const now = new Date();
    return this.prisma.product.updateMany({
      where: {
        id,
        ...buildProductAccessWhere(access, ProductStatus.ACTIVE),
      },
      data: {
        status: ProductStatus.SUSPENDED,
        statusReason: reason,
        suspendedAt: now,
        suspendedById: userId,
        updatedById: userId,
        updatedAt: now,
      },
    });
  }

  // The release pointer is part of the predicate so the transition stays a single
  // atomic write. The Product Release feature tightens this to also require that
  // the release is PUBLISHED and belongs to this Product.
  reactivateSuspended({
    id,
    access,
    userId,
  }: {
    id: string;
    access: ProductAccess;
    userId: string;
  }) {
    return this.prisma.product.updateMany({
      where: {
        id,
        ...buildProductAccessWhere(access, ProductStatus.SUSPENDED),
        currentReleaseId: {
          not: null,
        },
      },
      data: {
        status: ProductStatus.ACTIVE,
        statusReason: null,
        suspendedAt: null,
        suspendedById: null,
        updatedById: userId,
        updatedAt: new Date(),
      },
    });
  }

  private async replaceMedia({
    productId,
    media,
  }: {
    productId: string;
    media: ProductMediaInputType[];
  }) {
    await this.prisma.productMedia.updateMany({
      where: {
        productId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    if (media.length === 0) {
      return;
    }

    await this.prisma.productMedia.createMany({
      data: media.map((item) => ({
        productId,
        staticId: item.staticId,
        type: item.type,
        sortOrder: item.sortOrder,
        altText: item.altText ?? null,
      })),
    });
  }

  private toManagementOutput(product: ProductRow): ProductManagementOutputType {
    const { Project, ProductMedia, ...rest } = product;
    return {
      ...rest,
      project: Project,
      media: ProductMedia,
    };
  }

  private toDetailOutput(product: ProductDetailRow): ProductDetailOutputType {
    const { ProductOffer, ...rest } = product;
    return {
      ...this.toManagementOutput(rest),
      offers: ProductOffer,
    };
  }
}
