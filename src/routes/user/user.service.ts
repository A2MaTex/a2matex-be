import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserStatus } from '../../shared/constants/auth.constant.ts';
import {
  AdminUserAuditAction,
  AdminUserPublisherAuditEntry,
  AdminUserStatusAuditEntry,
  type AdminUserAuditHistoryEntryType,
} from '../../entities/user.model.ts';
import { PublisherAccountStatus } from '../../shared/constants/publisher.constant.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { EmailService } from '../../shared/services/email.service.tsx';
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
import { PublisherRepo } from '../publisher/publisher.repo.ts';
import { PublisherRoleUnavailableException } from '../publisher/publisher.error.ts';

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
      const lastBan = target.auditHistory.findLast((entry) => {
        const result = AdminUserStatusAuditEntry.safeParse(entry);
        return result.success && result.data.action === AdminUserAuditAction.USER_BANNED;
      });
      const lastBanEntry = AdminUserStatusAuditEntry.safeParse(lastBan);
      if (
        !lastBanEntry.success ||
        lastBanEntry.data.details.currentStatus !== UserStatus.BANNED ||
        (lastBanEntry.data.details.previousStatus !== UserStatus.ACTIVE &&
          lastBanEntry.data.details.previousStatus !== UserStatus.INACTIVE)
      ) {
        throw UserStatusTransitionDeniedException;
      }
      nextStatus = lastBanEntry.data.details.previousStatus;
    }

    const changedAt = new Date();
    const transitioned = await this.adminUserRepo.transitionStatus({
      id: userId,
      expectedStatus: data.expectedStatus,
      status: nextStatus,
      action:
        data.action === AdminUserStatusAction.BAN
          ? AdminUserAuditAction.USER_BANNED
          : AdminUserAuditAction.USER_UNBANNED,
      reason: data.reason,
      changedAt,
      changedById: adminUserId,
    });
    if (!transitioned) {
      throw UserStatusConflictException;
    }

    if (data.action === AdminUserStatusAction.BAN) {
      await this.blockPublisherForBannedUser({
        userId,
        reason: data.reason,
        changedAt,
        changedById: adminUserId,
      });
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
      await this.restorePublisherAfterUserUnban({
        userId,
        auditHistory: target.auditHistory,
        reason: data.reason,
        changedAt,
        changedById: adminUserId,
      });
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

  private async blockPublisherForBannedUser({
    userId,
    reason,
    changedAt,
    changedById,
  }: {
    userId: string;
    reason: string;
    changedAt: Date;
    changedById: string;
  }): Promise<void> {
    const account = await this.publisherRepo.getAccountByUserId(userId);
    if (!account) {
      return;
    }

    const lockedAccount = await this.publisherRepo.lockPublisherAccount(account.id);
    if (!lockedAccount || lockedAccount.status !== PublisherAccountStatus.ACTIVE) {
      return;
    }

    await this.publisherRepo.softDeletePublisherRole({ userId, deletedAt: changedAt });
    await this.publisherRepo.updateStatus({
      id: lockedAccount.id,
      status: PublisherAccountStatus.BLOCKED,
      actorId: changedById,
      reason,
      changedAt,
    });
    await this.publisherRepo.appendUserAuditHistory({
      userId,
      action: AdminUserAuditAction.PUBLISHER_BLOCKED,
      reason,
      performedAt: changedAt,
      performedById: changedById,
      details: {
        publisherAccountId: lockedAccount.id,
        previousStatus: lockedAccount.status,
        currentStatus: PublisherAccountStatus.BLOCKED,
        source: AdminUserAuditAction.USER_BANNED,
      },
    });
  }

  private async restorePublisherAfterUserUnban({
    userId,
    auditHistory,
    reason,
    changedAt,
    changedById,
  }: {
    userId: string;
    auditHistory: AdminUserAuditHistoryEntryType[];
    reason: string;
    changedAt: Date;
    changedById: string;
  }): Promise<void> {
    const account = await this.publisherRepo.getAccountByUserId(userId);
    if (!account) {
      return;
    }

    const lockedAccount = await this.publisherRepo.lockPublisherAccount(account.id);
    if (!lockedAccount || lockedAccount.status !== PublisherAccountStatus.BLOCKED) {
      return;
    }

    const latestPublisherAudit = auditHistory.findLast((entry) => {
      const result = AdminUserPublisherAuditEntry.safeParse(entry);
      return result.success && result.data.details.publisherAccountId === lockedAccount.id;
    });
    const parsedAudit = AdminUserPublisherAuditEntry.safeParse(latestPublisherAudit);
    if (
      !parsedAudit.success ||
      parsedAudit.data.action !== AdminUserAuditAction.PUBLISHER_BLOCKED ||
      parsedAudit.data.details.source !== AdminUserAuditAction.USER_BANNED
    ) {
      return;
    }

    const publisherRole = await this.publisherRepo.getActivePublisherRole();
    if (!publisherRole) {
      throw PublisherRoleUnavailableException;
    }

    await this.publisherRepo.ensureUserRole({ userId, roleId: publisherRole.id });
    await this.publisherRepo.updateStatus({
      id: lockedAccount.id,
      status: PublisherAccountStatus.ACTIVE,
      actorId: changedById,
      reason,
      changedAt,
    });
    await this.publisherRepo.appendUserAuditHistory({
      userId,
      action: AdminUserAuditAction.PUBLISHER_UNBLOCKED,
      reason,
      performedAt: changedAt,
      performedById: changedById,
      details: {
        publisherAccountId: lockedAccount.id,
        previousStatus: lockedAccount.status,
        currentStatus: PublisherAccountStatus.ACTIVE,
        source: AdminUserAuditAction.USER_UNBANNED,
      },
    });
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
    await this.transactionService.afterCommit(async () => {
      try {
        const { error } = await this.emailService.sendUserBanned({
          email,
          username,
          reason,
          changedAt: changedAt.toISOString(),
        });
        if (error) {
          this.logger.error(
            `Ban email provider rejected request userId=${userId}: ${error.message}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to send ban email userId=${userId}`,
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
    await this.transactionService.afterCommit(async () => {
      try {
        const { error } = await this.emailService.sendUserUnbanned({
          email,
          username,
          status,
          reason,
          changedAt: changedAt.toISOString(),
        });
        if (error) {
          this.logger.error(
            `Unban email provider rejected request userId=${userId}: ${error.message}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to send unban email userId=${userId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    });
  }
}
