import z from 'zod';
import { zDate } from '../shared/utils/zod.ts';
import { BaseWithUserFields } from './base.model.ts';

export const Profile = BaseWithUserFields.extend({
  userId: z.uuid(),
  fullName: z.string(),
  avatarStaticId: z.string().nullable(),
  bio: z.string().nullable(),
  website: z.string().nullable(),
  twitter: z.string().nullable(),
  linkedin: z.string().nullable(),
  github: z.string().nullable(),
  instagram: z.string().nullable(),
  gender: z.string().nullable(),
  birthday: zDate().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  balance: z.bigint(),
});

export type ProfileType = z.infer<typeof Profile>;
