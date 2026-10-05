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

const sharedServices = [
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
  exports: [...sharedServices, cacheProvider, objectStorageProvider, AccessTokenGuard],
  imports: [JwtModule],
})
export class SharedModule {}
