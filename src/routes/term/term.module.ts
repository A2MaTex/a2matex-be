import { Module } from '@nestjs/common';
import { TermController } from './term.controller.ts';
import { TermRepo } from './term.repo.ts';
import { TermService } from './term.service.ts';

@Module({
  controllers: [TermController],
  providers: [TermService, TermRepo],
  exports: [TermRepo],
})
export class TermModule {}
