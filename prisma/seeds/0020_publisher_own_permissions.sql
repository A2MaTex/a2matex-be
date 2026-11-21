-- Permission scope OWN cho cac route mo cho Publisher.
--
-- Route nao mo cho Publisher la quyet dinh nghiep vu, khong scan ra duoc tu controller
-- nhu cac file module lam voi row scope NULL, nen khai tay o day. Seed chi insert row vao
-- bang Permission, khong gan cho role: chi ADMIN duoc seed gan quyen, cac role con lai
-- admin tu gan qua PUT /api/v1/roles/:roleId/permissions.
-- Chay sau 0001-0015, va `npm run seed:clear-cache` sau cung.

DO $$
DECLARE
    v_actor   UUID;
    v_unknown TEXT;
    v_added   INT;
BEGIN
    SELECT ur."userId" INTO v_actor
    FROM "UserRole" ur
             JOIN "Role" r ON r.id = ur."roleId"
             JOIN "User" u ON u.id = ur."userId"
    WHERE r.name = 'ADMIN'
      AND r."deletedAt" IS NULL
      AND ur."deletedAt" IS NULL
      AND u."deletedAt" IS NULL
    LIMIT 1;

    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Khong tim thay admin user, chay seed:roles truoc';
    END IF;

    CREATE TEMP TABLE seed_publisher_own_routes (
        method TEXT,
        path   TEXT
    ) ON COMMIT DROP;

    -- Nhom 1: policy phan nhanh theo scope, OWN giu caller trong publisher account
    -- cua chinh no con null doc tat ca.
    -- Nhom 2: policy bo qua scope va tu resolve publisher. Row OWN van tao de admin gan
    -- duoc OWN thay vi phai gan ban unrestricted cua route.
    INSERT INTO seed_publisher_own_routes (method, path)
    VALUES ('GET',   '/api/v1/projects'),
           ('GET',   '/api/v1/projects/:projectId'),
           ('PUT',   '/api/v1/projects/:projectId'),
           ('PUT',   '/api/v1/projects/:projectId/archive'),
           ('GET',   '/api/v1/projects/:projectId/draft'),
           ('PUT',   '/api/v1/projects/:projectId/draft'),
           ('GET',   '/api/v1/products'),
           ('GET',   '/api/v1/products/:productId'),
           ('PATCH', '/api/v1/products/:productId'),
           ('PUT',   '/api/v1/products/:productId/lifecycle'),
           ('GET',   '/api/v1/submissions'),
           ('GET',   '/api/v1/submissions/:submissionId'),
           ('POST',  '/api/v1/projects'),
           ('POST',  '/api/v1/products'),
           ('POST',  '/api/v1/submissions');

    -- Bang permission scope NULL chinh la bang route: cac file module sinh no tu
    -- controller, nen route doi ten se khong khop va seed fail o day.
    SELECT string_agg(format('%s %s', r.method, r.path), E'\n')
    INTO v_unknown
    FROM seed_publisher_own_routes r
    WHERE NOT EXISTS (SELECT 1
                      FROM "Permission" p
                      WHERE p.method = r.method::"HTTPMethod"
                        AND p.path = r.path
                        AND p.scope IS NULL
                        AND p."deletedAt" IS NULL);

    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'Route khong co trong bang Permission, chay seed module truoc hoac route da doi ten:%', E'\n' || v_unknown;
    END IF;

    -- Partial unique index chi phu scope IS NOT NULL nen ON CONFLICT dung duoc o day,
    -- nhung NOT EXISTS khoi phai lap lai predicate cua index.
    INSERT INTO "Permission" (name, module, description, path, method, scope, "createdById", "updatedById")
    SELECT r.method || ' ' || r.path || ' (OWN)',
           upper(split_part(r.path, '/', 4)),
           r.method || ' ' || r.path || ' limited to the caller''s own records',
           r.path,
           r.method::"HTTPMethod",
           'OWN'::"PermissionScope",
           v_actor,
           v_actor
    FROM seed_publisher_own_routes r
    WHERE NOT EXISTS (SELECT 1
                      FROM "Permission" p
                      WHERE p.method = r.method::"HTTPMethod"
                        AND p.path = r.path
                        AND p.scope = 'OWN'
                        AND p."deletedAt" IS NULL);
    GET DIAGNOSTICS v_added = ROW_COUNT;

    RAISE NOTICE 'PUBLISHER OWN: % route, them % permission, chua gan cho role nao',
        (SELECT count(*) FROM seed_publisher_own_routes), v_added;
END $$;
