import { Module } from '@nestjs/common';
import { RoleController } from './role.controller.ts';
import { RoleRepo } from './role.repo.ts';
import { RoleService } from './role.service.ts';

@Module({
  providers: [RoleService, RoleRepo],
  controllers: [RoleController],
})
export class RoleModule {}
