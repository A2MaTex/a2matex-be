import { VerificationCode } from '../../entities/verification.model.ts';
import { User } from '../../entities/user.model.ts';
import { z } from 'zod';

export const RegisterInput = User.pick({
  username: true,
  email: true,
  password: true,
})
  .extend({
    confirmPassword: z.string().min(6).max(100),
    code: z.string().length(6),
  })
  .strict()
  .superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
      ctx.addIssue({
        code: 'custom',
        message: 'Password and confirm password must match',
        path: ['confirmPassword'],
      });
    }
  });

export const SendOTPInput = VerificationCode.pick({
  email: true,
  type: true,
}).strict();

export const LoginInput = User.pick({
  password: true,
})
  .extend({
    account: z.string().min(1).max(500),
    code: z.string().length(6).optional(),
  })
  .strict();

export const LoginOutput = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const RegisterOutput = LoginOutput;

export const RefreshTokenInput = z
  .object({
    refreshToken: z.string(),
  })
  .strict();

export const RefreshTokenOutput = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const LogoutInput = RefreshTokenInput;

export const ForgotPasswordInput = z
  .object({
    email: z.email(),
    code: z.string().length(6),
    newPassword: z.string().min(6).max(100),
    confirmNewPassword: z.string().min(6).max(100),
  })
  .strict()
  .superRefine(({ confirmNewPassword, newPassword }, ctx) => {
    if (confirmNewPassword !== newPassword) {
      ctx.addIssue({
        code: 'custom',
        message: 'New password and confirm new password must match',
        path: ['confirmNewPassword'],
      });
    }
  });

export type RegisterInputType = z.infer<typeof RegisterInput>;
export type RegisterOutputType = z.infer<typeof RegisterOutput>;
export type SendOTPInputType = z.infer<typeof SendOTPInput>;
export type LoginInputType = z.infer<typeof LoginInput>;
export type LoginOutputType = z.infer<typeof LoginOutput>;
export type RefreshTokenInputType = z.infer<typeof RefreshTokenInput>;
export type RefreshTokenOutputType = z.infer<typeof RefreshTokenOutput>;
export type LogoutInputType = z.infer<typeof LogoutInput>;
export type ForgotPasswordInputType = z.infer<typeof ForgotPasswordInput>;
