// Identifiers of the operational values an Admin manages. A key is only usable once it is
// also declared in the registry (src/routes/system-setting/system-setting.registry.ts);
// this object exists so call sites refer to a constant rather than a loose string.
export const SystemSettingKey = {
  COMMISSION_RATE_BPS: 'COMMISSION_RATE_BPS',
  SEPAY_BANK_ACCOUNT_NUMBER: 'SEPAY_BANK_ACCOUNT_NUMBER',
  SEPAY_BANK_NAME: 'SEPAY_BANK_NAME',
  SEPAY_BANK_ACCOUNT_HOLDER: 'SEPAY_BANK_ACCOUNT_HOLDER',
  WITHDRAWAL_MIN_AMOUNT: 'WITHDRAWAL_MIN_AMOUNT',
} as const;

export type SystemSettingKeyValue = (typeof SystemSettingKey)[keyof typeof SystemSettingKey];
