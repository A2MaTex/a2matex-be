import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProjectStatus } from '../../shared/constants/project.constant.ts';
import {
  PublisherAccountStatus,
  type PublisherAccountStatusType,
} from '../../shared/constants/publisher.constant.ts';
import { PermissionScope } from '../../shared/constants/role.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
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
  private readonly logger = new Logger(ProjectService.name);

  constructor(@Inject(ProjectRepo) private readonly projectRepo: ProjectRepo) {}

  async create({
    data,
    userId,
    scopes,
  }: {
    data: CreateProjectInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }) {
    if (!scopes.includes(PermissionScope.OWN)) {
      throw ProjectAccessDeniedException;
    }

    const publisherAccount = await this.getActivePublisherAccount(userId);
    const project = await this.projectRepo.create({
      data,
      publisherAccountId: publisherAccount.id,
      userId,
    });
    this.logger.log(
      `Project created projectId=${project.id} publisherAccountId=${project.publisherAccountId} actorId=${userId}`,
    );
    return project;
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
    const project = await this.projectRepo.updateActive({ id, data, access, userId });
    if (project) {
      this.logger.log(
        `Project updated projectId=${project.id} publisherAccountId=${project.publisherAccountId} actorId=${userId}`,
      );
      return project;
    }

    return this.throwMutationFailure(id, access);
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
    const project = await this.projectRepo.archiveActive({ id, access, userId });
    if (project) {
      this.logger.log(
        `Project archived projectId=${project.id} publisherAccountId=${project.publisherAccountId} actorId=${userId} status=${ProjectStatus.ARCHIVED}`,
      );
      return project;
    }

    const existingProject = await this.projectRepo.getById({ id, access });
    if (!existingProject) {
      throw ProjectNotFoundException;
    }

    return existingProject;
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
