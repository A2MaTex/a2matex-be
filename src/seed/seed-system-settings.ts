import { PrismaService } from '../shared/services/prisma.service.ts';
import { SystemSettingKey } from '../shared/constants/system-setting.constant.ts';

// One-off bridge for the move of the bank details out of the environment.
//
// A SQL migration cannot read environment variables, so it creates these rows empty. This
// script is the only place that sees both sides, and it runs once per environment while
// the variables are still present. The follow-up release then removes them.
//
// Reads process.env directly rather than through config.ts, so it keeps working after
// those three variables are dropped from the schema.
const BRIDGED_KEYS = [
  SystemSettingKey.SEPAY_BANK_ACCOUNT_NUMBER,
  SystemSettingKey.SEPAY_BANK_NAME,
  SystemSettingKey.SEPAY_BANK_ACCOUNT_HOLDER,
] as const;

async function seedBankDetails(prisma: PrismaService) {
  for (const key of BRIDGED_KEYS) {
    const incoming = process.env[key]?.trim();
    if (!incoming) {
      console.log(`${key}: no environment value, skipped`);
      continue;
    }

    const current = await prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    if (!current) {
      console.error(`${key}: no row to fill; run the migration first`);
      continue;
    }

    // Only an empty row is filled. Re-running must never overwrite a value an Admin has
    // since set through the API.
    const stored = (current.value as { value?: unknown } | null)?.value;
    if (typeof stored === 'string' && stored.length > 0) {
      console.log(`${key}: already set, left alone`);
      continue;
    }

    // updatedAt and updatedById stay null: nobody edited this, the value only moved from
    // one store to another. The check constraint requires the pair to agree anyway.
    await prisma.systemSetting.update({
      where: { key },
      data: { value: { value: incoming } },
    });
    console.log(`${key}: filled from the environment`);
  }
}

async function bootstrap() {
  const prisma = new PrismaService();
  try {
    await seedBankDetails(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
