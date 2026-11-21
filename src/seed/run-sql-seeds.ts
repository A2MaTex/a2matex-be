import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import envConfig from '../shared/config.ts';
import { clearRolePermissionCache } from './clear-role-permission-cache.ts';

const seedDirectory = path.resolve(import.meta.dirname, '../../prisma/seeds');

function getSeedFiles(filter?: string) {
  const files = fs
    .readdirSync(seedDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  return filter ? files.filter((name) => name.startsWith(filter)) : files;
}

async function bootstrap() {
  const [filter] = process.argv.slice(2);
  const files = getSeedFiles(filter);
  if (files.length === 0) {
    throw new Error(`No seed file matches "${filter}"`);
  }

  const client = new Client({ connectionString: envConfig.DATABASE_URL });
  // `prisma db execute` drops NOTICE and WARNING, and the leak check in 0020 is a
  // warning, so the seeds run through node-postgres instead.
  client.on('notice', ({ severity, message }) => console.log(`  ${severity}: ${message}`));

  await client.connect();
  try {
    for (const file of files) {
      console.log(file);
      await client.query(fs.readFileSync(path.join(seedDirectory, file), 'utf8'));
    }
  } finally {
    await client.end();
  }

  await clearRolePermissionCache();
}

bootstrap().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
