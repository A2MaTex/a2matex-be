import { z } from 'zod';
import { TermStatus, TermType } from '../shared/constants/publisher.constant.ts';
import { BaseWithUserFields } from './base.model.ts';
import { zDate } from '../shared/utils/zod.ts';

export const Term = BaseWithUserFields.extend({
  type: z.enum([TermType.PUBLISHER_TERMS, TermType.CUSTOMER_TERMS, TermType.PRIVACY_POLICY]),
  version: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  status: z.enum([TermStatus.DRAFT, TermStatus.ACTIVE, TermStatus.ARCHIVED]),
  publishedAt: zDate().nullable(),
});

export type TermEntityType = z.infer<typeof Term>;
