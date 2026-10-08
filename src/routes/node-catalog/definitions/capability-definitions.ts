import { z } from 'zod';
import {
  NODE_CAPABILITY_CODE_MAX_LENGTH,
  NODE_CAPABILITY_CODE_PATTERN,
  NODE_NAME_MAX_LENGTH,
  NodeCapability,
} from '../node-catalog.constant.ts';

export const CapabilityDefinitionContract = z
  .object({
    code: z
      .string()
      .min(1)
      .max(NODE_CAPABILITY_CODE_MAX_LENGTH)
      .regex(NODE_CAPABILITY_CODE_PATTERN),
    name: z.string().trim().min(1).max(NODE_NAME_MAX_LENGTH),
    description: z.string().trim().min(1),
    isSensitive: z.boolean(),
  })
  .strict();

export const CapabilityDefinitionCatalogContract = z
  .array(CapabilityDefinitionContract)
  .nonempty()
  .superRefine((definitions, ctx) => {
    const codes = new Set<string>();
    definitions.forEach(({ code }, index) => {
      if (codes.has(code)) {
        ctx.addIssue({
          code: 'custom',
          message: `Capability '${code}' must be unique`,
          path: [index, 'code'],
        });
      }
      codes.add(code);
    });
  });

export const CAPABILITY_DEFINITIONS = CapabilityDefinitionCatalogContract.parse([
  {
    code: NodeCapability.ANDROID_DEVICE_CONTROL,
    name: 'Android Device Control',
    description: 'Allows a workflow to send interaction commands to an Android device.',
    isSensitive: true,
  },
  {
    code: NodeCapability.ANDROID_SCREEN_CAPTURE,
    name: 'Android Screen Capture',
    description: 'Allows a workflow to capture the visible Android device screen.',
    isSensitive: true,
  },
]);

export type CapabilityDefinitionType = z.infer<typeof CapabilityDefinitionContract>;
