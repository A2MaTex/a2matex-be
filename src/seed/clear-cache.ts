import { clearRolePermissionCache } from './clear-role-permission-cache.ts';

// The SQL seeds write straight to the database and cannot reach Redis themselves.
clearRolePermissionCache().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
