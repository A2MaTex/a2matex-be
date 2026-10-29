import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../services/prisma.service.ts';

@Injectable()
export class ProjectAccessRepo {
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
}
