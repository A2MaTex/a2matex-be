import { z } from 'zod';
import { WithdrawalRequestStatus } from '../shared/constants/withdrawal.constant.ts';

export const WithdrawalRequestStatusSchema = z.enum([
  WithdrawalRequestStatus.PENDING,
  WithdrawalRequestStatus.APPROVED,
  WithdrawalRequestStatus.REJECTED,
  WithdrawalRequestStatus.PAID,
  WithdrawalRequestStatus.CANCELLED,
]);
