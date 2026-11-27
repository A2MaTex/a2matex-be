import { z } from 'zod';
import { zBigIntString } from '../../shared/utils/zod.ts';

// Shape the Admin Portal uses to build an input without hardcoding the key list. Kept
// deliberately small: a full JSON Schema generated from Zod would pull in a dependency
// nobody has asked for, and the portal only needs enough to pick a widget.
export type SettingFieldSpec = {
  name: string;
  type: 'integer' | 'string';
  min?: number;
  max?: number;
  maxLength?: number;
};

export type SettingValueSpec = {
  type: 'object';
  fields: SettingFieldSpec[];
};

export type SettingDefinition<S extends z.ZodType = z.ZodType> = {
  schema: S;
  description: string;
  valueSchema: SettingValueSpec;
};

// Per-key declarations. Adding one here is all it takes for the key to appear in the
// Admin listing, be writable, and be covered by the startup check.
export const settingRegistry = {
  // Payout phase 2 is the first reader. Basis points, never a float: at 29% the floating
  // multiplication disagrees with integer arithmetic on 7030 of 2 million prices tried,
  // and phase 2 requires commission + publisher share to equal the total exactly.
  COMMISSION_RATE_BPS: {
    schema: z.object({ rateBps: z.number().int().min(0).max(10000) }),
    description: 'Ti le hoa hong san giu lai tren moi don hang, tinh bang basis point (3000 = 30%)',
    valueSchema: {
      type: 'object',
      fields: [{ name: 'rateBps', type: 'integer', min: 0, max: 10000 }],
    },
  },
  // Shown to a customer on the top-up screen. An empty string is valid here on purpose:
  // the migration has to create these rows before anyone has a value to put in them, and
  // refusing an empty value is the reading side's job (TopUpService).
  SEPAY_BANK_ACCOUNT_NUMBER: {
    schema: z.object({ value: z.string().max(50) }),
    description: 'So tai khoan ngan hang nhan tien nap cua khach',
    valueSchema: { type: 'object', fields: [{ name: 'value', type: 'string', maxLength: 50 }] },
  },
  SEPAY_BANK_NAME: {
    schema: z.object({ value: z.string().max(255) }),
    description: 'Ten ngan hang nhan tien nap',
    valueSchema: { type: 'object', fields: [{ name: 'value', type: 'string', maxLength: 255 }] },
  },
  SEPAY_BANK_ACCOUNT_HOLDER: {
    schema: z.object({ value: z.string().max(255) }),
    description: 'Ten chu tai khoan nhan tien nap',
    valueSchema: { type: 'object', fields: [{ name: 'value', type: 'string', maxLength: 255 }] },
  },
  // Tien de chuoi chu khong phai so: tien trong he thong la BigInt, de o day thanh so thuc
  // la tao ra dung mot cho tien song duoi dang khac. Regex chan tran BIGINT chu khong chi
  // chan "toan chu so" — ^\\d{1,19}$ tran trui cho qua 9999999999999999999 vuot tran, roi
  // PostgreSQL nem 22003 va nguoi dung nhan 500 thay vi 422.
  WITHDRAWAL_MIN_AMOUNT: {
    schema: z.object({
      // Dung chung zBigIntString voi duong tao don rut tien: hai duong ghi phai dong y
      // voi nhau the nao la mot so tien hop le, neu khong admin dat duoc mot muc toi
      // thieu ma publisher khong bao gio rut duoc.
      amount: zBigIntString(),
    }),
    description: 'Muc rut toi thieu cho mot don rut tien cua nha phat hanh, don vi dong',
    valueSchema: {
      type: 'object',
      fields: [{ name: 'amount', type: 'string', maxLength: 19 }],
    },
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingRegistry = typeof settingRegistry;
export type SettingKey = keyof SettingRegistry;
export type SettingValue<K extends SettingKey> = z.infer<SettingRegistry[K]['schema']>;

export type AnySettingRegistry = Record<string, SettingDefinition>;

// Object.hasOwn, not `in`: "toString" and friends are reachable through the prototype and
// would otherwise pass as declared keys.
export const isRegisteredKey = (registry: AnySettingRegistry, key: string): boolean =>
  Object.hasOwn(registry, key);

export const getDefinition = (
  registry: AnySettingRegistry,
  key: string,
): SettingDefinition | undefined => (isRegisteredKey(registry, key) ? registry[key] : undefined);

export const registeredKeys = (registry: AnySettingRegistry): string[] => Object.keys(registry);
