import { z } from 'zod';
import { SystemAccountType } from '../shared/constants/wallet.constant.ts';
import { zDate } from '../shared/utils/zod.ts';

export const SystemAccountTypeSchema = z.enum([SystemAccountType.PLATFORM_REVENUE]);

// Tiền của sàn. Cố ý không thuộc về một người dùng nào — xem spec 011 Clarifications
// 2026-11-25 và research.md R4.
export const SystemAccount = z.object({
  type: SystemAccountTypeSchema,
  balance: z.bigint(),
  updatedAt: zDate().nullable(),
});

export type SystemAccountEntityType = z.infer<typeof SystemAccount>;
