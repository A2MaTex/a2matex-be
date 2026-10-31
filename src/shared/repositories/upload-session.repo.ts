import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../services/prisma.service.ts';
import { UploadSessionStatus } from '../constants/uploading-session.constant.ts';
import envConfig from '../config.ts';

export type CreateSessionInput = {
  id: string;
  createdBy: string;
  expiresAt: Date;
  fileHash: string;
  fileKey: string;
  uploadId: string;
  originalName: string;
  contentType: string;
  size: number;
};

@Injectable()
export class UploadSessionRepository {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  async getExistingByFileHash(fileHash: string) {
    return this.prisma.staticUploadSession.findUnique({
      where: {
        fileHash: fileHash,
        status: {
          notIn: [UploadSessionStatus.ABORTED],
        },
      },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        fileKey: true,
        uploadId: true,
      },
    });
  }

  async getById(id: string) {
    return this.prisma.staticUploadSession.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        fileKey: true,
        uploadId: true,
        originalName: true,
        contentType: true,
        size: true,
        status: true,
      },
    });
  }

  async getExpiredSessions() {
    return this.prisma.staticUploadSession.findMany({
      where: {
        status: UploadSessionStatus.UPLOADING,
        expiresAt: {
          lt: new Date(),
        },
      },
      select: {
        id: true,
        fileKey: true,
        uploadId: true,
      },
    });
  }

  create(input: CreateSessionInput) {
    return this.prisma.staticUploadSession.create({
      data: {
        id: input.id,
        createdBy: {
          connect: {
            id: input.createdBy,
          },
        },
        expiresAt: input.expiresAt,
        fileHash: input.fileHash,
        fileKey: input.fileKey,
        uploadId: input.uploadId,
        status: UploadSessionStatus.UPLOADING,
        originalName: input.originalName,
        contentType: input.contentType,
        size: BigInt(input.size),
      },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        fileKey: true,
        uploadId: true,
      },
    });
  }

  endSession(id: string) {
    return this.prisma.staticUploadSession.update({
      where: {
        id,
        status: UploadSessionStatus.UPLOADING,
      },
      data: {
        status: UploadSessionStatus.COMPLETED,
      },
      select: {
        id: true,
      },
    });
  }
  abortSession(id: string) {
    return this.prisma.staticUploadSession.update({
      where: {
        id,
        status: UploadSessionStatus.UPLOADING,
      },
      data: {
        status: UploadSessionStatus.ABORTED,
      },
      select: {
        id: true,
      },
    });
  }

  softDeleteSession(id: string) {
    return this.prisma.staticUploadSession.update({
      where: {
        id,
      },
      data: {
        status: UploadSessionStatus.ABORTED,
        deletedAt: new Date(),
      },
      select: {
        id: true,
        deletedAt: true,
      },
    });
  }
}
