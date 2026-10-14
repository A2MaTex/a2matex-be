import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { ProjectStatus } from '../../shared/constants/project.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { buildProjectAccessWhere, type ProjectAccess } from '../project/project-access.model.ts';
import type { ProjectDraftOutputType, SaveProjectDraftInputType } from './project-draft.model.ts';

const PROJECT_DRAFT_SELECT = {
  id: true,
  projectId: true,
  version: true,
  editorGraph: true,
  inputSchema: true,
  runtimeIr: true,
  validationSummary: true,
  testSummary: true,
  contentHash: true,
  savedAt: true,
} satisfies Prisma.ProjectDraftSelect;

const PROJECT_DRAFT_SYNC_SELECT = {
  id: true,
  version: true,
  contentHash: true,
  savedAt: true,
} satisfies Prisma.ProjectDraftSelect;

type DraftContent = Omit<SaveProjectDraftInputType, 'expectedVersion'>;
type PrismaDraftContent = Pick<
  Prisma.ProjectDraftUncheckedCreateInput,
  'editorGraph' | 'inputSchema' | 'runtimeIr' | 'validationSummary' | 'testSummary'
>;

@Injectable()
export class ProjectDraftRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  async getAccessibleProject({ projectId, access }: { projectId: string; access: ProjectAccess }) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        ...buildProjectAccessWhere(access),
      },
      select: {
        status: true,
        ProjectDraft: {
          where: { deletedAt: null },
          select: PROJECT_DRAFT_SELECT,
        },
      },
    });

    if (!project) {
      return null;
    }

    // Database JSON checks guarantee these selected values are objects (or null for runtimeIr).
    return {
      status: project.status,
      ProjectDraft: project.ProjectDraft as ProjectDraftOutputType | null,
    };
  }

  create({
    projectId,
    content,
    contentHash,
    savedById,
  }: {
    projectId: string;
    content: DraftContent;
    contentHash: string;
    savedById: string;
  }) {
    return this.prisma.projectDraft.create({
      data: {
        projectId,
        version: 1,
        ...this.toPrismaContent(content),
        contentHash,
        savedById,
      },
      select: PROJECT_DRAFT_SYNC_SELECT,
    });
  }

  updateChanged({
    projectId,
    expectedVersion,
    content,
    contentHash,
    savedById,
    access,
  }: {
    projectId: string;
    expectedVersion: number;
    content: DraftContent;
    contentHash: string;
    savedById: string;
    access: ProjectAccess;
  }) {
    const savedAt = new Date();
    return this.prisma.projectDraft.updateManyAndReturn({
      where: {
        projectId,
        version: expectedVersion,
        contentHash: { not: contentHash },
        deletedAt: null,
        Project: {
          is: buildProjectAccessWhere(access, ProjectStatus.ACTIVE),
        },
      },
      data: {
        ...this.toPrismaContent(content),
        version: { increment: 1 },
        contentHash,
        savedAt,
        savedById,
        updatedAt: savedAt,
      },
      select: PROJECT_DRAFT_SYNC_SELECT,
    });
  }

  private toPrismaContent(content: DraftContent): PrismaDraftContent {
    return {
      editorGraph: content.editorGraph,
      inputSchema: content.inputSchema,
      runtimeIr: content.runtimeIr === null ? Prisma.DbNull : content.runtimeIr,
      validationSummary: content.validationSummary,
      testSummary: content.testSummary,
    };
  }
}
