import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserStatus } from '../../shared/constants/auth.constant.ts';
import { AdminUserAuditAction } from '../../shared/constants/user.constant.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { EmailService } from '../../shared/services/email.service.tsx';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import type { MessageResType } from '../../shared/models/response.model.ts';
import {
  AdminTargetProtectedException,
  UserNotFoundException,
  UserSelfBanDeniedException,
  UserStatusConflictException,
  UserStatusTransitionDeniedException,
} from './user.error.ts';
import type {
  AdminUserStatusChangeContext,
  AdminUserStatusTarget,
  GetAdminUserDetailOutputType,
  GetAdminUserListInputType,
  GetAdminUserListOutputType,
  UpdateAdminUserStatusParams,
  UserStatusNotificationParams,
  UserStatusNotificationTask,
  UserUnbanNotificationParams,
} from './user.type.ts';
import { AdminUserRepo } from './user.repo.ts';
import { PublisherRepo } from '../publisher/publisher.repo.ts';

@Injectable()
export class AdminUserService {
  private readonly logger = new Logger(AdminUserService.name);

  constructor(
    @Inject(AdminUserRepo) private readonly adminUserRepo: AdminUserRepo,
    @Inject(PublisherRepo) private readonly publisherRepo: PublisherRepo,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {}

  getList(query: GetAdminUserListInputType): Promise<GetAdminUserListOutputType> {
    return this.adminUserRepo.getList(query);
  }

  async getDetail(id: string): Promise<GetAdminUserDetailOutputType> {
    const user = await this.adminUserRepo.getDetail(id);
    if (!user) {
      throw UserNotFoundException;
    }

    return user;
  }

  @Transactional()
  async updateStatus(params: UpdateAdminUserStatusParams): Promise<MessageResType> {
    const target = await this.getStatusTarget(params.userId);
    this.validateStatusChange(params, target);

    const context: AdminUserStatusChangeContext = {
      ...params,
      target,
      changedAt: new Date(),
    };
    await this.transitionUserStatus(context);
    await this.handleStatusChange(context);

    return SUCCESS_RESPONSE;
  }

  private async getStatusTarget(userId: string): Promise<AdminUserStatusTarget> {
    const target = await this.adminUserRepo.getStatusTarget(userId);
    if (!target) {
      throw UserNotFoundException;
    }
    return target;
  }

  private validateStatusChange(
    { userId, adminUserId, data }: UpdateAdminUserStatusParams,
    target: AdminUserStatusTarget,
  ): void {
    if (data.status === UserStatus.BANNED && userId === adminUserId) {
      throw UserSelfBanDeniedException;
    }
    if (target.isProtectedAdmin) {
      throw AdminTargetProtectedException;
    }

    if (data.status === UserStatus.BANNED) {
      if (target.status === UserStatus.BANNED) {
        throw UserStatusTransitionDeniedException;
      }
    } else {
      if (target.status !== UserStatus.BANNED) {
        throw UserStatusTransitionDeniedException;
      }
    }
  }

  private async transitionUserStatus({
    userId,
    adminUserId,
    data,
    target,
    changedAt,
  }: AdminUserStatusChangeContext): Promise<void> {
    const transitioned = await this.adminUserRepo.transitionStatus({
      id: userId,
      expectedStatus: target.status,
      status: data.status,
      action:
        data.status === UserStatus.BANNED
          ? AdminUserAuditAction.USER_BANNED
          : AdminUserAuditAction.USER_UNBANNED,
      reason: data.reason,
      changedAt,
      changedById: adminUserId,
    });
    if (!transitioned) {
      throw UserStatusConflictException;
    }
  }

  private async handleStatusChange(context: AdminUserStatusChangeContext): Promise<void> {
    if (context.data.status === UserStatus.BANNED) {
      await this.handleUserBan(context);
      return;
    }
    await this.handleUserUnban(context);
  }

  private async handleUserBan({
    userId,
    data,
    target,
    changedAt,
  }: AdminUserStatusChangeContext): Promise<void> {
    await this.adminUserRepo.revokeAllSessions(userId, changedAt);
    await this.scheduleBanNotification({
      userId,
      username: target.username,
      email: target.email,
      reason: data.reason,
      changedAt,
    });
  }

  private async handleUserUnban({
    userId,
    data,
    target,
    changedAt,
  }: AdminUserStatusChangeContext): Promise<void> {
    await this.scheduleUnbanNotification({
      userId,
      username: target.username,
      email: target.email,
      status: UserStatus.ACTIVE,
      reason: data.reason,
      changedAt,
    });
  }

  private async scheduleBanNotification({
    userId,
    username,
    email,
    reason,
    changedAt,
  }: UserStatusNotificationParams): Promise<void> {
    await this.scheduleStatusNotification({
      userId,
      type: 'ban',
      send: () =>
        this.emailService.sendUserBanned({
          email,
          username,
          reason,
          changedAt: changedAt.toISOString(),
        }),
    });
  }

  private async scheduleUnbanNotification({
    userId,
    username,
    email,
    status,
    reason,
    changedAt,
  }: UserUnbanNotificationParams): Promise<void> {
    await this.scheduleStatusNotification({
      userId,
      type: 'unban',
      send: () =>
        this.emailService.sendUserUnbanned({
          email,
          username,
          status,
          reason,
          changedAt: changedAt.toISOString(),
        }),
    });
  }

  private async scheduleStatusNotification({
    userId,
    type,
    send,
  }: UserStatusNotificationTask): Promise<void> {
    await this.transactionService.afterCommit(async () => {
      try {
        const { error } = await send();
        if (error) {
          throw error;
        }
      } catch (error) {
        this.logger.error(
          `Failed to send ${type} email userId=${userId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    });
  }
}