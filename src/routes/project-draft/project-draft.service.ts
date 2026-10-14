import { Inject, Injectable } from '@nestjs/common';
import { ProjectStatus } from '../../shared/constants/project.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { ProjectAccessPolicy } from '../project/project-access.policy.ts';
import { projectDraftVersionConflictException } from './project-draft.error.ts';
import type {
  ProjectDraftSyncOutputType,
  SaveProjectDraftInputType,
} from './project-draft.model.ts';
import { ProjectDraftRepo } from './project-draft.repo.ts';
import { prepareProjectDraftContent } from './project-draft.util.ts';
import { ProjectArchivedException, ProjectNotFoundException } from '../project/project.error.ts';

@Injectable()
export class ProjectDraftService {
  constructor(
    @Inject(ProjectDraftRepo) private readonly projectDraftRepo: ProjectDraftRepo,
    @Inject(ProjectAccessPolicy) private readonly projectAccessPolicy: ProjectAccessPolicy,
  ) {}

  async get({
    projectId,
    userId,
    scopes,
  }: {
    projectId: string;
    userId: string;
    scopes: ActivePermissionScope[];
  }) {
    const access = await this.projectAccessPolicy.resolveReadAccess(userId, scopes);
    if (!access) {
      throw ProjectNotFoundException;
    }

    const project = await this.projectDraftRepo.getAccessibleProject({ projectId, access });
    if (!project) {
      throw ProjectNotFoundException;
    }

    return {
      projectStatus: project.status,
      draft: project.ProjectDraft,
    };
  }

  async save({
    projectId,
    data,
    userId,
    scopes,
  }: {
    projectId: string;
    data: SaveProjectDraftInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<ProjectDraftSyncOutputType> {
    const access = await this.projectAccessPolicy.resolveDraftSaveAccess(userId, scopes);
    const project = await this.projectDraftRepo.getAccessibleProject({ projectId, access });
    if (!project) {
      throw ProjectNotFoundException;
    }
    if (project.status === ProjectStatus.ARCHIVED) {
      throw ProjectArchivedException;
    }

    const { content, contentHash } = prepareProjectDraftContent(data);

    if (data.expectedVersion === 0 && !project.ProjectDraft) {
      try {
        return await this.projectDraftRepo.create({
          projectId,
          content,
          contentHash,
          savedById: userId,
        });
      } catch (error) {
        if (!isUniqueConstraintPrismaError(error)) {
          throw error;
        }
      }
    } else if (data.expectedVersion > 0) {
      const updated = await this.projectDraftRepo.updateChanged({
        projectId,
        expectedVersion: data.expectedVersion,
        content,
        contentHash,
        savedById: userId,
        access,
      });
      if (updated[0]) {
        return updated[0];
      }
    }

    return this.resolveUnchangedOrConflictingSave({ projectId, access, contentHash });
  }

  private async resolveUnchangedOrConflictingSave({
    projectId,
    access,
    contentHash,
  }: {
    projectId: string;
    access: Awaited<ReturnType<ProjectAccessPolicy['resolveDraftSaveAccess']>>;
    contentHash: string;
  }): Promise<ProjectDraftSyncOutputType> {
    const project = await this.projectDraftRepo.getAccessibleProject({ projectId, access });
    if (!project) {
      throw ProjectNotFoundException;
    }
    if (project.status === ProjectStatus.ARCHIVED) {
      throw ProjectArchivedException;
    }

    const currentDraft = project.ProjectDraft;
    if (currentDraft?.contentHash === contentHash) {
      const { id, version, savedAt } = currentDraft;
      return { id, version, contentHash, savedAt };
    }

    throw projectDraftVersionConflictException(currentDraft?.version ?? 0);
  }
}
