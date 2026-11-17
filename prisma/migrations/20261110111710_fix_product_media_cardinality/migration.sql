BEGIN;

CREATE UNIQUE INDEX "ProductMedia_active_icon_cover_idx"
ON "ProductMedia" ("productId", type)
WHERE "deletedAt" IS NULL AND type IN ('ICON', 'COVER');

DROP INDEX "ProductMedia_single_icon_idx", "ProductMedia_single_cover_idx";

COMMIT;
