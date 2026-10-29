import { Inject, Injectable } from '@nestjs/common';
import { ProjectStatus } from '../../shared/constants/project.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import type { ProjectAccess } from '../../shared/models/project-access.model.ts';
import { ProjectAccessPolicy } from '../../shared/services/project-access.policy.ts';
import { ProjectArchivedException, ProjectNotFoundException } from './project.error.ts';
import type {
  CreateProjectInputType,
  GetProjectListInputType,
  UpdateProjectInputType,
} from './project.model.ts';
import { ProjectRepo } from './project.repo.ts';

@Injectable()
export class ProjectService {
  constructor(
    @Inject(ProjectRepo) private readonly projectRepo: ProjectRepo,
    @Inject(ProjectAccessPolicy) private readonly projectAccessPolicy: ProjectAccessPolicy,
  ) {}

  async create({ data, userId }: { data: CreateProjectInputType; userId: string }) {
    const publisherAccount = await this.projectAccessPolicy.getActivePublisherAccount(userId);
    try {
      return await this.projectRepo.create({
        data,
        publisherAccountId: publisherAccount.id,
        userId,
      });
    } catch (error) {
      if (!isUniqueConstraintPrismaError(error)) {
        throw error;
      }

      const existingProject = await this.projectRepo.getByNormalizedName({
        name: data.name,
        publisherAccountId: publisherAccount.id,
      });
      if (!existingProject) {
        throw error;
      }
      if (existingProject.status === ProjectStatus.ARCHIVED) {
        throw ProjectArchivedException;
      }

      return { id: existingProject.id };
    }
  }

  async getList({
    query,
    userId,
    scopes,
  }: {
    query: GetProjectListInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }) {
    const access = await this.projectAccessPolicy.resolveReadAccess(userId, scopes);
    if (!access) {
      const { page, limit } = getPagination(query);
      return {
        items: [],
        totalItems: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    return this.projectRepo.getList({ query, access });
  }

  async getDetail({
    id,
    userId,
    scopes,
  }: {
    id: string;
    userId: string;
    scopes: ActivePermissionScope[];
  }) {
    const access = await this.projectAccessPolicy.resolveReadAccess(userId, scopes);
    if (!access) {
      throw ProjectNotFoundException;
    }

    const project = await this.projectRepo.getById({ id, access });
    if (!project) {
      throw ProjectNotFoundException;
    }
    return project;
  }

  async update({
    id,
    data,
    userId,
    scopes,
  }: {
    id: string;
    data: UpdateProjectInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }) {
    const access = await this.projectAccessPolicy.resolveMutationAccess(userId, scopes);
    const result = await this.projectRepo.updateActive({ id, data, access, userId });
    if (result.count === 0) {
      await this.throwMutationFailure(id, access);
    }

    return SUCCESS_RESPONSE;
  }

  async archive({
    id,
    userId,
    scopes,
  }: {
    id: string;
    userId: string;
    scopes: ActivePermissionScope[];
  }) {
    const access = await this.projectAccessPolicy.resolveMutationAccess(userId, scopes);
    const result = await this.projectRepo.archiveActive({ id, access, userId });
    if (result.count === 0) {
      const existingProject = await this.projectRepo.getById({ id, access });
      if (!existingProject) {
        throw ProjectNotFoundException;
      }
    }

    return SUCCESS_RESPONSE;
  }

  private async throwMutationFailure(id: string, access: ProjectAccess): Promise<never> {
    const project = await this.projectRepo.getById({ id, access });
    if (!project) {
      throw ProjectNotFoundException;
    }
    throw ProjectArchivedException;
  }
}
