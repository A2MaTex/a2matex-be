import { Module } from '@nestjs/common';
import { PermissionController } from './permission.controller.ts';
import { PermissionRepo } from './permission.repo.ts';
import { PermissionService } from './permission.service.ts';

@Module({
  providers: [PermissionService, PermissionRepo],
  controllers: [PermissionController],
})
export class PermissionModule {}
