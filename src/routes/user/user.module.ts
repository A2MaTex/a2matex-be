import { Module } from '@nestjs/common';
import { AdminUserController } from './user.controller.ts';
import { AdminUserRepo } from './user.repo.ts';
import { AdminUserService } from './user.service.ts';

@Module({
  controllers: [AdminUserController],
  providers: [AdminUserService, AdminUserRepo],
})
export class UserModule {}
