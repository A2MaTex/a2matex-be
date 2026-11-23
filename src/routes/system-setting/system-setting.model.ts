import { z } from 'zod';
import { zDate, zJsonObject } from '../../shared/utils/zod.ts';

export const SystemSettingKeyParam = z
  .object({
    key: z.string().trim().min(1).max(100),
  })
  .strict();

// The body carries a raw object; the key's own schema from the registry is what actually
// validates it, because every key has a different shape.
export const UpdateSystemSettingInput = z
  .object({
    value: z.record(z.string(), z.json()),
  })
  .strict();

// Output only, so the stored object is handed back as-is instead of being walked and
// cloned on every read. The input above stays strict: that one is accepted, not returned.
export const SystemSettingOutput = z.object({
  key: z.string(),
  value: zJsonObject().nullable(),
  description: z.string(),
  valueSchema: zJsonObject(),
  updatedAt: zDate().nullable(),
  updatedById: z.uuid().nullable(),
});

// `items`, matching every other list route; the transform interceptor adds the outer
// `data` wrapper. No pagination: the registry is the source and it holds four keys.
export const GetSystemSettingsOutput = z.object({
  items: z.array(SystemSettingOutput),
});

export type SystemSettingKeyParamType = z.infer<typeof SystemSettingKeyParam>;
export type UpdateSystemSettingInputType = z.infer<typeof UpdateSystemSettingInput>;
export type SystemSettingOutputType = z.infer<typeof SystemSettingOutput>;
export type GetSystemSettingsOutputType = z.infer<typeof GetSystemSettingsOutput>;
