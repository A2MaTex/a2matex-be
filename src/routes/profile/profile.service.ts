import { Inject, Injectable } from '@nestjs/common';
import { HashingService } from '../../shared/services/hashing.service.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import { isNotFoundPrismaError } from '../../shared/utils/prisma.ts';
import { NotFoundRecordException } from '../../shared/types/error.type.ts';
import {
  ConfirmNewPasswordMismatchException,
  CurrentPasswordInvalidException,
  ProfileNotFoundException,
} from './profile.error.ts';
import { ChangePasswordInputType, UpdatePersonalProfileInputType } from './profile.model.ts';
import { ProfileRepo } from './profile.repo.ts';

@Injectable()
export class ProfileService {
  constructor(
    @Inject(ProfileRepo) private readonly profileRepo: ProfileRepo,
    @Inject(HashingService) private readonly hashingService: HashingService,
  ) {}

  async getMe(userId: string) {
    const profile = await this.profileRepo.getMe(userId);
    if (!profile) {
      throw ProfileNotFoundException;
    }

    return profile;
  }

  async updatePersonalProfile({
    userId,
    data,
  }: {
    userId: string;
    data: UpdatePersonalProfileInputType;
  }) {
    const user = await this.profileRepo.getUserPassword(userId);
    if (!user) {
      throw NotFoundRecordException;
    }

    await this.profileRepo.updatePersonalProfile({
      userId,
      data,
      fallbackFullName: user.username,
    });

    return SUCCESS_RESPONSE;
  }

  async changePassword({ userId, data }: { userId: string; data: ChangePasswordInputType }) {
    try {
      if (data.newPassword !== data.confirmNewPassword) {
        throw ConfirmNewPasswordMismatchException;
      }

      const user = await this.profileRepo.getUserPassword(userId);
      if (!user) {
        throw NotFoundRecordException;
      }

      const isCurrentPasswordValid = await this.hashingService.compare(
        data.currentPassword,
        user.password,
      );
      if (!isCurrentPasswordValid) {
        throw CurrentPasswordInvalidException;
      }

      const hashedPassword = await this.hashingService.hash(data.newPassword);
      await this.profileRepo.changePassword({
        userId,
        password: hashedPassword,
      });

      return SUCCESS_RESPONSE;
    } catch (error) {
      if (isNotFoundPrismaError(error)) {
        throw NotFoundRecordException;
      }
      throw error;
    }
  }
}
