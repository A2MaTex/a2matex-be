import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import type { StaticEntityType } from '../../entities/static.model.ts';
import { PrismaService } from '../services/prisma.service.ts';

export type CreateStaticInput = {
  id: string;
  objectKey: string;
  originalFileName: string;
  contentType: string;
  size: bigint;
};

export type CreateStaticOutput = {
  id: string;
  originalFileName: string;
  size: bigint;
  contentType: string;
};

export type StaticImageVariantRecord = {
  objectKey: string;
  contentType: string;
  size: bigint;
  width: number;
  height: number;
};

export type CreateStaticImageVariantInput = StaticImageVariantRecord & {
  id: string;
  variant: 'SMALL' | 'MEDIUM';
};

export type StaticDeletionRecord = {
  objectKeys: string[];
};

@Injectable()
export class StaticRepository {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  create(input: CreateStaticInput): Promise<CreateStaticOutput> {
    return this.prisma.static.create({
      data: input,
      select: {
        id: true,
        originalFileName: true,
        size: true,
        contentType: true,
      },
    });
  }

  async createImage({
    staticRecord,
    variants,
  }: {
    staticRecord: CreateStaticInput;
    variants: CreateStaticImageVariantInput[];
  }): Promise<CreateStaticOutput> {
    const createdStatic = await this.create(staticRecord);
    const values = variants.map((variant) => {
      return Prisma.sql`(
        ${variant.id}::uuid,
        ${staticRecord.id}::uuid,
        ${variant.variant}::"StaticImageVariantType",
        ${variant.objectKey},
        ${variant.contentType},
        ${variant.size},
        ${variant.width},
        ${variant.height}
      )`;
    });

    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "StaticImageVariant" (
        "id",
        "staticId",
        "variant",
        "objectKey",
        "contentType",
        "size",
        "width",
        "height"
      )
      VALUES ${Prisma.join(values)}
    `);

    return createdStatic;
  }

  findById(id: string): Promise<StaticEntityType | null> {
    return this.prisma.static.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        id: true,
        objectKey: true,
        originalFileName: true,
        contentType: true,
        size: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
  }

  findByFileKey(filekey: string): Promise<StaticEntityType | null> {
    return this.prisma.static.findFirst({
      where: {
        objectKey: filekey,
        deletedAt: null,
      },
      select: {
        id: true,
        objectKey: true,
        originalFileName: true,
        contentType: true,
        size: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
  }

  async findForDeletion(id: string): Promise<StaticDeletionRecord | null> {
    const staticRecord = await this.prisma.static.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        objectKey: true,
        StaticImageVariant: {
          select: {
            objectKey: true,
          },
        },
      },
    });
    if (!staticRecord) {
      return null;
    }

    return {
      objectKeys: [
        staticRecord.objectKey,
        ...staticRecord.StaticImageVariant.map(({ objectKey }) => objectKey),
      ],
    };
  }

  async softDelete(id: string): Promise<void> {
    const now = new Date();
    await this.prisma.static.updateMany({
      where: {
        id,
        deletedAt: null,
      },
      data: {
        deletedAt: now,
        updatedAt: now,
      },
    });
  }

  async findImageVariant(
    staticId: string,
    variant: 'SMALL' | 'MEDIUM',
  ): Promise<StaticImageVariantRecord | null> {
    const records = await this.prisma.$queryRaw<StaticImageVariantRecord[]>(Prisma.sql`
      SELECT
        "objectKey",
        "contentType",
        "size",
        "width",
        "height"
      FROM "StaticImageVariant"
      WHERE "staticId" = ${staticId}::uuid
        AND "variant" = ${variant}::"StaticImageVariantType"
      LIMIT 1
    `);
    return records[0] ?? null;
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.static.deleteMany({
      where: {
        id,
      },
    });
  }
}
