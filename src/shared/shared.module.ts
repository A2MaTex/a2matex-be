import { Global, Module } from '@nestjs/common';
import { PrismaService } from './services/prisma.service.js';
import { HashingService } from './services/hashing.service.js';
import { TokenService } from './services/token.service.js';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { SharedUserRepository } from './repositories/shared-user.repo.js';
import { EmailService } from './services/email.service.js';
import { SharedRoleRepository } from './repositories/shared-role.repo.js';

const sharedServices = [
  PrismaService,
  HashingService,
  TokenService,
  EmailService,
  SharedUserRepository,
  SharedRoleRepository,
];

@Global()
@Module({
  providers: [...sharedServices],
  exports: sharedServices,
  imports: [JwtModule],
})
export class SharedModule {}
