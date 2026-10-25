import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import { ProjectStatus } from '../../shared/constants/project.constant.ts';
import { STATIC_IMAGE_OUTPUT_CONTENT_TYPE } from '../../shared/constants/storage.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import type { CreateProductInputType, ProductManagementOutputType } from './product.model.ts';

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

  private toManagementOutput(product: ProductRow): ProductManagementOutputType {
    const { Project, ProductMedia, ...rest } = product;
    return {
      ...rest,
      project: Project,
      media: ProductMedia,
    };
  }
}
