import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import { ProjectStatus } from '../../shared/constants/project.constant.ts';
import { STATIC_IMAGE_OUTPUT_CONTENT_TYPE } from '../../shared/constants/storage.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { buildProductAccessWhere, type ProductAccess } from './product-access.model.ts';
import type {
  CreateProductInputType,
  GetProductListInputType,
  GetProductListOutputType,
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

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

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

  async getByProjectId({
    projectId,
    publisherAccountId,
  }: {
    projectId: string;
    publisherAccountId: string;
  }): Promise<ProductManagementOutputType | null> {
    const product = await this.prisma.product.findFirst({
      where: {
        projectId,
        publisherAccountId,
        deletedAt: null,
      },
      select: PRODUCT_SELECT,
    });
    return product ? this.toManagementOutput(product) : null;
  }

  // Requiring a generated variant row is what proves the image went through the
  // image pipeline: the plain file upload stores the caller's raw mimetype, so a
  // .webp uploaded there would pass a contentType check on its own.
  countEligibleMedia({
    staticIds,
    publisherAccountId,
  }: {
    staticIds: string[];
    publisherAccountId: string;
  }) {
    return this.prisma.static.count({
      where: {
        id: {
          in: staticIds,
        },
        deletedAt: null,
        publisherAccountId,
        contentType: STATIC_IMAGE_OUTPUT_CONTENT_TYPE,
        StaticImageVariant: {
          some: {},
        },
      },
    });
  }

  async createWithMedia({
    data,
    publisherAccountId,
    userId,
  }: {
    data: CreateProductInputType;
    publisherAccountId: string;
    userId: string;
  }): Promise<ProductManagementOutputType> {
    const product = await this.prisma.product.create({
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
      select: PRODUCT_SELECT,
    });
    return this.toManagementOutput(product);
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

  // Returns null when no row matched, which the service turns into not-found,
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
  }): Promise<ProductManagementOutputType | null> {
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
      return null;
    }

    if (media !== undefined) {
      await this.replaceMedia({ productId: id, media });
    }

    return this.getById({ id, access: { unrestricted: false, publisherAccountId } });
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
  reactivateSuspended({ id, access, userId }: { id: string; access: ProductAccess; userId: string }) {
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
}
