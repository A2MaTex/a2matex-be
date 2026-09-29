import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller.ts';
import { ProfileRepo } from './profile.repo.ts';
import { ProfileService } from './profile.service.ts';

@Module({
  providers: [ProfileService, ProfileRepo],
  controllers: [ProfileController],
})
export class ProfileModule {}
