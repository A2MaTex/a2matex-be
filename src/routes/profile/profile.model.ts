import { z } from 'zod';
import { Profile } from '../../entities/profile.model.ts';

export const ProfileOutput = Profile.pick({
  id: true,
  fullName: true,
  avatarStaticId: true,
  bio: true,
  website: true,
  twitter: true,
  linkedin: true,
  github: true,
  instagram: true,
  gender: true,
  birthday: true,
  address: true,
  phone: true,
  email: true,
  createdAt: true,
});

const PersonalProfileFields = Profile.pick({
  fullName: true,
  avatarStaticId: true,
  bio: true,
  website: true,
  twitter: true,
  linkedin: true,
  github: true,
  instagram: true,
  gender: true,
  address: true,
  phone: true,
  email: true,
}).extend({
  fullName: z.string().min(1).max(255),
  avatarStaticId: z.uuid().nullable(),
  gender: z.string().max(20).nullable(),
  email: z.email().nullable(),
  birthday: z.coerce.date().nullable(),
});

export const UpdatePersonalProfileInput = PersonalProfileFields.partial().strict();

export const ChangePasswordInput = z
  .object({
    currentPassword: z.string().min(6).max(100),
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

export type ProfileOutputType = z.infer<typeof ProfileOutput>;
export type UpdatePersonalProfileInputType = z.infer<typeof UpdatePersonalProfileInput>;
export type ChangePasswordInputType = z.infer<typeof ChangePasswordInput>;
