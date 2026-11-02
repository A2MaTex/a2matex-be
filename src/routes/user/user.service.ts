import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UserStatus } from '../../shared/constants/auth.constant.ts';
import { KAFKA_TOPICS } from '../../shared/constants/kafka.constant.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import {
  type MessageProvider,
  QUEUE_PROVIDER,
} from '../../shared/infrastructure/queue/queue.interface.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import {
  AdminTargetProtectedException,
  UserNotFoundException,
  UserSelfBanDeniedException,
  UserStatusConflictException,
  UserStatusTransitionDeniedException,
} from './user.error.ts';
import type {
  GetAdminUserDetailOutputType,
  GetAdminUserListInputType,
  GetAdminUserListOutputType,
  UpdateAdminUserStatusInputType,
  UpdateAdminUserStatusOutputType,
} from './user.model.ts';
import { AdminUserStatusAction } from './user.model.ts';
import { AdminUserRepo } from './user.repo.ts';
import {
  ADMIN_USER_BANNED_EVENT_TYPE,
  ADMIN_USER_UNBANNED_EVENT_TYPE,
} from './user-status.event.ts';

@Injectable()
export class AdminUserService {
  private readonly logger = new Logger(AdminUserService.name);

  constructor(
    @Inject(AdminUserRepo) private readonly adminUserRepo: AdminUserRepo,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
    @Inject(QUEUE_PROVIDER) private readonly queue: MessageProvider,
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
  async updateStatus({
    userId,
    adminUserId,
    data,
  }: {
    userId: string;
    adminUserId: string;
    data: UpdateAdminUserStatusInputType;
  }): Promise<UpdateAdminUserStatusOutputType> {
    const target = await this.adminUserRepo.getStatusTarget(userId);
    if (!target) {
      throw UserNotFoundException;
    }

    if (data.action === AdminUserStatusAction.BAN && userId === adminUserId) {
      throw UserSelfBanDeniedException;
    }
    if (target.isProtectedAdmin) {
      throw AdminTargetProtectedException;
    }

    let nextStatus:
      typeof UserStatus.ACTIVE | typeof UserStatus.INACTIVE | typeof UserStatus.BANNED;
    if (data.action === AdminUserStatusAction.BAN) {
      if (target.status === UserStatus.BANNED) {
        throw UserStatusTransitionDeniedException;
      }
      if (target.status !== data.expectedStatus) {
        throw UserStatusConflictException;
      }
      nextStatus = UserStatus.BANNED;
    } else {
      if (target.status !== UserStatus.BANNED) {
        throw UserStatusTransitionDeniedException;
      }
      if (target.status !== data.expectedStatus) {
        throw UserStatusConflictException;
      }
      if (
        target.previousStatus !== UserStatus.ACTIVE &&
        target.previousStatus !== UserStatus.INACTIVE
      ) {
        throw UserStatusTransitionDeniedException;
      }
      nextStatus = target.previousStatus;
    }

    const changedAt = new Date();
    const transitioned = await this.adminUserRepo.transitionStatus({
      id: userId,
      expectedStatus: data.expectedStatus,
      status: nextStatus,
      reason: data.reason,
      changedAt,
      changedById: adminUserId,
    });
    if (!transitioned) {
      throw UserStatusConflictException;
    }

    if (data.action === AdminUserStatusAction.BAN) {
      await this.adminUserRepo.revokeAllSessions(userId, changedAt);
      await this.scheduleBanNotification({
        userId,
        username: target.username,
        email: target.email,
        reason: data.reason,
        changedAt,
      });
    } else {
      if (nextStatus === UserStatus.BANNED) {
        throw UserStatusTransitionDeniedException;
      }
      await this.scheduleUnbanNotification({
        userId,
        username: target.username,
        email: target.email,
        status: nextStatus,
        reason: data.reason,
        changedAt,
      });
    }

    return {
      id: userId,
      previousStatus: target.status,
      status: nextStatus,
      reason: data.reason,
      changedAt,
    };
  }

  private async scheduleBanNotification({
    userId,
    username,
    email,
    reason,
    changedAt,
  }: {
    userId: string;
    username: string;
    email: string;
    reason: string;
    changedAt: Date;
  }): Promise<void> {
    const messageId = randomUUID();
    await this.transactionService.afterCommit(async () => {
      try {
        await this.queue.publish({
          topic: KAFKA_TOPICS.USER_BANNED_NOTIFICATION,
          key: userId,
          message: {
            id: messageId,
            type: ADMIN_USER_BANNED_EVENT_TYPE,
            occurredAt: changedAt.toISOString(),
            payload: {
              userId,
              username,
              email,
              status: UserStatus.BANNED,
              reason,
              changedAt: changedAt.toISOString(),
            },
          },
        });
      } catch (error) {
        this.logger.error(
          `Failed to publish ban notification userId=${userId} messageId=${messageId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    });
  }

  private async scheduleUnbanNotification({
    userId,
    username,
    email,
    status,
    reason,
    changedAt,
  }: {
    userId: string;
    username: string;
    email: string;
    status: typeof UserStatus.ACTIVE | typeof UserStatus.INACTIVE;
    reason: string;
    changedAt: Date;
  }): Promise<void> {
    const messageId = randomUUID();
    await this.transactionService.afterCommit(async () => {
      try {
        await this.queue.publish({
          topic: KAFKA_TOPICS.USER_UNBANNED_NOTIFICATION,
          key: userId,
          message: {
            id: messageId,
            type: ADMIN_USER_UNBANNED_EVENT_TYPE,
            occurredAt: changedAt.toISOString(),
            payload: {
              userId,
              username,
              email,
              status,
              reason,
              changedAt: changedAt.toISOString(),
            },
          },
        });
      } catch (error) {
        this.logger.error(
          `Failed to publish unban notification userId=${userId} messageId=${messageId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    });
  }
}
