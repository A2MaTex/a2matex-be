import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from './shared/constants/route.constant.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors();
  const port = Number(process.env.PORT) || 9999;
  await app.listen(port, () => {
    console.log(`Application is running on: http://localhost:${port}`);
    console.log(`API docs: http://localhost:${port}/api/docs`);
  });
}
await bootstrap();
