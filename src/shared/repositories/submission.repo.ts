import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../services/prisma.service.ts';
import { JsonValue } from '@prisma/client/runtime/client';

export type FindSubmissionOutput = {
  id: string;
  productId: string;
  status: string;
  contentHash: string;
  scanStatus: string;
  productSnapshot: {
    slug: string;
  };
  releaseRequest: {
    minimumLauncherVersion: string;
    minimumRuntimeVersion: string;
    version: string;
  };
  runtimeIr: {
    entryNodeId: string;
    requiredCapabilities: string[];
    [key: string]: unknown;
  };
  inputSchema: JsonValue;
};

@Injectable()
export class SubmissionRepository {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  async findById(id: string): Promise<FindSubmissionOutput | null> {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        WorkflowRevision: true,
      },
    });

    if (!submission) return null;

    return {
      ...submission,
      productSnapshot: submission.productSnapshot as {
        slug: string;
      },
      contentHash: submission.WorkflowRevision.contentHash as string,
      releaseRequest: submission.releaseRequest as {
        minimumLauncherVersion: string;
        minimumRuntimeVersion: string;
        version: string;
      },
      runtimeIr: submission.WorkflowRevision.runtimeIr as {
        entryNodeId: string;
        requiredCapabilities: string[];
        [key: string]: unknown;
      },
      inputSchema: submission.WorkflowRevision.inputSchema as JsonValue,
    };
  }
}
