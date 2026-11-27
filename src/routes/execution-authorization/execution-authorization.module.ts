import envConfig from '../../shared/config.ts';
import { ExecutionAuthorizationController } from './execution-authorization.controller.ts';
import { Module } from '@nestjs/common';
import { EntitlementModule } from '../entitlement/entitlement.module.ts';
import { ExecutionAuthorizationRepo } from './execution-authorization.repo.ts';
import { ExecutionAuthorizationService } from './execution-authorization.service.ts';
import { ExecutionAuthorizationSigner } from './execution-authorization.signer.ts';

@Module({
  imports: [EntitlementModule],
  controllers: [ExecutionAuthorizationController],
  providers: [
    ExecutionAuthorizationRepo,
    {
      provide: ExecutionAuthorizationSigner,
      useFactory: () => new ExecutionAuthorizationSigner(envConfig),
    },
    ExecutionAuthorizationService,
  ],
  exports: [ExecutionAuthorizationService],
})
export class ExecutionAuthorizationModule {}
