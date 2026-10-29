import type { INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';
import { API_PREFIX_PATH } from '../shared/constants/system.constant.ts';

/**
 * Registered on the HTTP adapter, not as a controller: src/seed/create-permissions.ts
 * scans every `*controller.ts` under src/ and would turn this internal probe into a
 * Permission row. Adapter routes skip the global prefix, hence API_PREFIX_PATH.
 */
export function registerCronHealthRoute(app: INestApplication): void {
  app.getHttpAdapter().get(`${API_PREFIX_PATH}/health`, (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'cron',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });
}
