import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './routes/auth/auth.module.js';
import { SharedModule } from './shared/shared.module.js';

@Module({
  imports: [AuthModule, SharedModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
