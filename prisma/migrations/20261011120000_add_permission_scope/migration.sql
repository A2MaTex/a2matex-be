CREATE TYPE "PermissionScope" AS ENUM ('OWN');

ALTER TABLE "Permission"
ADD COLUMN scope "PermissionScope";

CREATE UNIQUE INDEX "Permission_method_path_scope_idx"
ON "Permission" (method, path, scope)
WHERE scope IS NOT NULL AND "deletedAt" IS NULL;
