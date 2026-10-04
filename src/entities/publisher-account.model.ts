import { z } from 'zod';
import { PublisherAccountStatus } from '../shared/constants/publisher.constant.ts';
import { zDate } from '../shared/utils/zod.ts';
import { Base } from './base.model.ts';

export const PublisherAccount = Base.extend({
  userId: z.uuid(),
  status: z.enum([PublisherAccountStatus.ACTIVE, PublisherAccountStatus.BLOCKED]),
  activatedAt: zDate(),
  blockedReason: z.string().nullable(),
  blockedAt: zDate().nullable(),
  blockedById: z.uuid().nullable(),
});

export type PublisherAccountType = z.infer<typeof PublisherAccount>;
