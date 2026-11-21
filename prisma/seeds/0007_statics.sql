-- Module STATICS: permission cho cac route cua module, gan cho role ADMIN.
--
-- Danh sach route lay tu controller (cung nguon voi src/seed/create-permissions.ts),
-- giu nguyen dinh dang name va description de hai seed khong da nhau.
-- Chay sau 0003_roles.sql, va chay `npm run seed:clear-cache` sau cung.

DO $$
DECLARE
    v_actor      UUID;
    v_admin_role UUID;
    v_added      INT;
    v_granted    INT;
BEGIN
    SELECT id INTO v_admin_role
    FROM "Role"
    WHERE name = 'ADMIN'
      AND "deletedAt" IS NULL;

    IF v_admin_role IS NULL THEN
        RAISE EXCEPTION 'Khong tim thay role ADMIN, chay seed:roles truoc';
    END IF;

    SELECT ur."userId" INTO v_actor
    FROM "UserRole" ur
             JOIN "User" u ON u.id = ur."userId"
    WHERE ur."roleId" = v_admin_role
      AND ur."deletedAt" IS NULL
      AND u."deletedAt" IS NULL
    LIMIT 1;

    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Khong tim thay admin user, chay seed:roles truoc';
    END IF;

    CREATE TEMP TABLE seed_routes (
        method TEXT,
        path   TEXT
    ) ON COMMIT DROP;

    INSERT INTO seed_routes (method, path)
    VALUES ('DELETE', '/api/v1/statics/:staticId'),
           ('GET',    '/api/v1/statics/files/:staticId'),
           ('GET',    '/api/v1/statics/files/:staticId/download-url'),
           ('POST',   '/api/v1/statics/files/multipart/abort'),
           ('POST',   '/api/v1/statics/files/multipart/cleanup-expired'),
           ('POST',   '/api/v1/statics/files/multipart/complete'),
           ('POST',   '/api/v1/statics/files/multipart/parts/completed'),
           ('POST',   '/api/v1/statics/files/multipart/start'),
           ('POST',   '/api/v1/statics/files/multipart/urls'),
           ('POST',   '/api/v1/statics/files/upload'),
           ('GET',    '/api/v1/statics/images/:staticId'),
           ('POST',   '/api/v1/statics/images/upload');

    -- Unique index cua Permission la partial, chi phu scope IS NOT NULL, nen ON CONFLICT
    -- khong infer duoc constraint cho row scope NULL. Chan trung bang NOT EXISTS.
    INSERT INTO "Permission" (name, module, description, path, method, "createdById", "updatedById")
    SELECT r.method || ' ' || r.path,
           'STATICS',
           r.method || ' ' || r.path,
           r.path,
           r.method::"HTTPMethod",
           v_actor,
           v_actor
    FROM seed_routes r
    WHERE NOT EXISTS (SELECT 1
                      FROM "Permission" p
                      WHERE p.method = r.method::"HTTPMethod"
                        AND p.path = r.path
                        AND p.scope IS NULL
                        AND p."deletedAt" IS NULL);
    GET DIAGNOSTICS v_added = ROW_COUNT;

    INSERT INTO "RolePermission" ("roleId", "permissionId")
    SELECT v_admin_role, p.id
    FROM seed_routes r
             JOIN "Permission" p ON p.method = r.method::"HTTPMethod"
        AND p.path = r.path
        AND p.scope IS NULL
        AND p."deletedAt" IS NULL
    WHERE NOT EXISTS (SELECT 1
                      FROM "RolePermission" rp
                      WHERE rp."roleId" = v_admin_role
                        AND rp."permissionId" = p.id
                        AND rp."deletedAt" IS NULL);
    GET DIAGNOSTICS v_granted = ROW_COUNT;

    RAISE NOTICE 'STATICS: % route, them % permission, gan % cho ADMIN',
        (SELECT count(*) FROM seed_routes), v_added, v_granted;
END $$;
