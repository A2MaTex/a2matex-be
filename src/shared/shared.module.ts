import { Global, Module } from '@nestjs/common';
import { PrismaService } from './services/prisma.service.js';
import { HashingService } from './services/hashing.service.js';
import { TokenService } from './services/token.service.js';
import { JwtModule } from '@nestjs/jwt';
import envConfig from './config.ts';
import { RedisCacheProvider } from './infrastructure/cache/redis/redis-cache.provider.ts';
import { CACHE_PROVIDER } from './infrastructure/cache/cache.interface.ts';
import { AccessTokenGuard } from './guards/access-token.guard.ts';
import { SharedUserRepository } from './repositories/shared-user.repo.js';
import { EmailService } from './services/email.service.js';
import { SharedRoleRepository } from './repositories/shared-role.repo.js';
import { TransactionContext } from './infrastructure/database/transaction/transaction-context.ts';
import { TransactionService } from './services/transaction.service.ts';
import { StaticRepository } from './repositories/static.repo.ts';
import { StaticService } from './services/static.service.ts';
import { OBJECT_STORAGE_PROVIDER } from './infrastructure/storage/object-storage.interface.ts';
import { S3ObjectStorageProvider } from './infrastructure/storage/s3/s3-object-storage.provider.ts';
import { ProjectAccessRepo } from './repositories/project-access.repo.ts';
import { ProjectAccessPolicy } from './services/project-access.policy.ts';
import { QueueModule } from './infrastructure/queue/queue.ts';
import { UploadSessionRepository } from './repositories/upload-session.repo.ts';
import { KeyService } from './services/key.service.ts';
import { ProductReleaseRepository } from './repositories/product-release.repo.ts';
import { SubmissionRepository } from './repositories/submission.repo.ts';

import { ContextLoggerService } from './infrastructure/logging/context-logger.service.js';
import { RequestLogContextService } from './infrastructure/logging/request-log-context.service.js';

const sharedServices = [
  ContextLoggerService,
  RequestLogContextService,
  PrismaService,
  TransactionContext,
  TransactionService,
  HashingService,
  TokenService,
  EmailService,
  SharedUserRepository,
  SharedRoleRepository,
  StaticRepository,
  StaticService,
  ProjectAccessRepo,
  ProjectAccessPolicy,
  UploadSessionRepository,
  KeyService,
  ProductReleaseRepository,
  SubmissionRepository,
];

const objectStorageProvider = {
  provide: OBJECT_STORAGE_PROVIDER,
  useClass: S3ObjectStorageProvider,
};

const cacheProvider = {
  provide: CACHE_PROVIDER,
  useFactory: async () => {
    const provider = new RedisCacheProvider({
      host: envConfig.REDIS_HOST,
      port: envConfig.REDIS_PORT,
      password: envConfig.REDIS_PASSWORD,
      keyPrefix: `${envConfig.REDIS_PREFIX}${envConfig.NODE_ENV}:`,
    });
    await provider.Connect();
    return provider;
  },
};

@Global()
@Module({
  providers: [...sharedServices, cacheProvider, objectStorageProvider, AccessTokenGuard],
  imports: [JwtModule, QueueModule],
  exports: [...sharedServices, cacheProvider, objectStorageProvider, AccessTokenGuard, QueueModule],
})
export class SharedModule {}
