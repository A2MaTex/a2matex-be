import { Inject, Injectable } from '@nestjs/common';
import {
  PublisherAccountStatus,
  type PublisherAccountStatusType,
} from '../../shared/constants/publisher.constant.ts';
import { PermissionScope } from '../../shared/constants/role.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import {
  PublisherBlockedException,
  PublisherNotActivatedException,
} from '../publisher/publisher.error.ts';
import {
  ProjectAccessDeniedException,
  ProjectArchivedException,
  ProjectNotFoundException,
} from './project.error.ts';
import type {
  CreateProjectInputType,
  GetProjectListInputType,
  UpdateProjectInputType,
} from './project.model.ts';
import { ProjectRepo, type ProjectAccess } from './project.repo.ts';

type PublisherAccount = {
  id: string;
  status: PublisherAccountStatusType;
};

@Injectable()
export class ProjectService {
  constructor(@Inject(ProjectRepo) private readonly projectRepo: ProjectRepo) {}

  async create({ data, userId }: { data: CreateProjectInputType; userId: string }) {
    const publisherAccount = await this.getActivePublisherAccount(userId);
    return this.projectRepo.create({
      data,
      publisherAccountId: publisherAccount.id,
      userId,
    });
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
    const access = await this.resolveReadAccess(userId, scopes);
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
    const access = await this.resolveReadAccess(userId, scopes);
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
    const access = await this.resolveMutationAccess(userId, scopes);
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
    const access = await this.resolveMutationAccess(userId, scopes);
    const result = await this.projectRepo.archiveActive({ id, access, userId });
    if (result.count === 0) {
      const existingProject = await this.projectRepo.getById({ id, access });
      if (!existingProject) {
        throw ProjectNotFoundException;
      }
    }

    return SUCCESS_RESPONSE;
  }

  private async resolveReadAccess(
    userId: string,
    scopes: ActivePermissionScope[],
  ): Promise<ProjectAccess | null> {
    if (scopes.includes(null)) {
      return { unrestricted: true };
    }
    if (!scopes.includes(PermissionScope.OWN)) {
      throw ProjectAccessDeniedException;
    }

    const publisherAccount = await this.projectRepo.getPublisherAccount(userId);
    return publisherAccount
      ? { unrestricted: false, publisherAccountId: publisherAccount.id }
      : null;
  }

  private async resolveMutationAccess(
    userId: string,
    scopes: ActivePermissionScope[],
  ): Promise<ProjectAccess> {
    if (scopes.includes(null)) {
      return { unrestricted: true };
    }
    if (!scopes.includes(PermissionScope.OWN)) {
      throw ProjectAccessDeniedException;
    }

    const publisherAccount = await this.getActivePublisherAccount(userId);
    return { unrestricted: false, publisherAccountId: publisherAccount.id };
  }

  private async getActivePublisherAccount(userId: string): Promise<PublisherAccount> {
    const publisherAccount = await this.projectRepo.getPublisherAccount(userId);
    if (!publisherAccount) {
      throw PublisherNotActivatedException;
    }
    if (publisherAccount.status === PublisherAccountStatus.BLOCKED) {
      throw PublisherBlockedException;
    }
    return publisherAccount;
  }

  private async throwMutationFailure(id: string, access: ProjectAccess): Promise<never> {
    const project = await this.projectRepo.getById({ id, access });
    if (!project) {
      throw ProjectNotFoundException;
    }
    throw ProjectArchivedException;
  }
}
