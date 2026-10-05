import { Inject, Injectable } from '@nestjs/common';
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
      },
    });
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

  async hardDelete(id: string): Promise<void> {
    await this.prisma.static.deleteMany({
      where: {
        id,
      },
    });
  }
}
