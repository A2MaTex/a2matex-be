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

const sharedServices = [
  PrismaService,
  HashingService,
  TokenService,
  EmailService,
  SharedUserRepository,
  SharedRoleRepository,
];

const cacheProvider = {
  provide: CACHE_PROVIDER,
  useFactory: async () => {
    const provider = new RedisCacheProvider({
      host: envConfig.REDIS_HOST,
      port: envConfig.REDIS_PORT,
      keyPrefix: `${envConfig.REDIS_PREFIX}${envConfig.NODE_ENV}:`,
    });
    await provider.Connect();
    return provider;
  },
};

@Global()
@Module({
  providers: [
    ...sharedServices,
    cacheProvider,
    AccessTokenGuard,
  ],
  exports: [...sharedServices, cacheProvider, AccessTokenGuard],
  imports: [JwtModule],
})
export class SharedModule {}
