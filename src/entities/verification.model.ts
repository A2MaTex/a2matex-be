import { Base } from './base.model.ts';
import { TypeOfVerificationCode } from '../shared/constants/auth.constant.ts';
import z from 'zod';

export const VerificationCode = Base.extend({
  email: z.email(),
  code: z.string().length(6),
  type: z.enum([
    TypeOfVerificationCode.REGISTER,
    TypeOfVerificationCode.FORGOT_PASSWORD,
    TypeOfVerificationCode.LOGIN,
    TypeOfVerificationCode.DISABLE_2FA,
  ]),
  expiresAt: z.date(),
});

export type VerificationCodeType = z.infer<typeof VerificationCode>;
