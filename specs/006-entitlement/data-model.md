# Data Model: 006-entitlement

Nguồn: spec FR-001–FR-006, FR-040; quyết định ở [research.md](./research.md) R1, R3, R8.
Một migration mới: `prisma/migrations/<timestamp>_add_entitlement/migration.sql` (tạo bằng
`npm run prisma:migrate:create`, rồi `prisma:generate`).

## Enum

```sql
CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'REVOKED');          -- R3: EXPIRED suy ra lúc đọc
CREATE TYPE "EntitlementGrantSource" AS ENUM ('ORDER', 'ADMIN_GRANT');
```

`ProductOfferType` đã có (migration `add_product_offer`).

## Bảng `Entitlement`

| Cột                    | Kiểu                       | Null | Ghi chú                                                         |
| ---------------------- | -------------------------- | ---- | --------------------------------------------------------------- |
| `id`                   | UUID PK                    | no   | `gen_random_uuid()`                                             |
| `customerId`           | UUID FK → `User`           | no   |                                                                 |
| `productId`            | UUID FK → `Product`        | no   |                                                                 |
| `status`               | `EntitlementStatus`        | no   | default `ACTIVE`                                                |
| `grantSource`          | `EntitlementGrantSource`   | no   | nguồn cấp gần nhất                                              |
| `grantedById`          | UUID FK → `User`           | yes  | Admin; chỉ có khi `grantSource = ADMIN_GRANT`                   |
| `startsAt`             | TIMESTAMPTZ(6)             | no   | đầu kỳ hiện tại                                                 |
| `expiresAt`            | TIMESTAMPTZ(6)             | yes  | null = vĩnh viễn                                                |
| `latestProductOfferId` | UUID FK → `ProductOffer`   | yes  | gói của lần mua gần nhất; Admin grant không đổi                 |
| `latestOrderItemId`    | UUID                       | yes  | **không FK ở 006** (R8); 007 thêm FK → `OrderItem`              |
| `oneTimePurchasedAt`   | TIMESTAMPTZ(6)             | yes  | set một lần bởi Order, không bao giờ xoá (FR-003)               |
| `grantSnapshot`        | JSONB                      | no   | hằng số MVP (FR-006)                                            |
| `revokedAt`            | TIMESTAMPTZ(6)             | yes  | chỉ khi `REVOKED`                                               |
| `revokedById`          | UUID FK → `User`           | yes  | chỉ khi `REVOKED`                                               |
| `revokedReason`        | TEXT                       | yes  | chỉ khi `REVOKED`                                               |
| `auditHistory`         | JSONB                      | no   | default `'[]'`; chỉ append bởi Admin grant/revoke (R1)          |
| `createdAt`            | TIMESTAMPTZ(6)             | no   | default `now()`                                                 |
| `updatedAt`            | TIMESTAMPTZ(6)             | yes  |                                                                 |

Không có `deletedAt`: quyền không bị xoá, chỉ thu hồi.

### Constraint và index

```sql
CONSTRAINT "Entitlement_customerId_productId_key" UNIQUE ("customerId", "productId")   -- FR-001

CONSTRAINT "Entitlement_period_check"
    CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt")                               -- FR-005

CONSTRAINT "Entitlement_revoke_fields_check" CHECK (                                     -- FR-005, hai chiều
    (status = 'REVOKED'
        AND "revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND "revokedReason" IS NOT NULL)
    OR
    (status <> 'REVOKED'
        AND "revokedAt" IS NULL AND "revokedById" IS NULL AND "revokedReason" IS NULL)
)

CONSTRAINT "Entitlement_granted_by_check" CHECK (                                     -- FR-002, hai chiều
    ("grantSource" = 'ADMIN_GRANT') = ("grantedById" IS NOT NULL)
)

CONSTRAINT "Entitlement_grantSnapshot_object_check" CHECK (jsonb_typeof("grantSnapshot") = 'object')
CONSTRAINT "Entitlement_auditHistory_array_check"  CHECK (jsonb_typeof("auditHistory") = 'array')
```

- Unique `(customerId, productId)` đồng thời phục vụ My Products (lọc theo `customerId`, prefix của
  index) và Admin lọc theo customer.
- `CREATE INDEX "Entitlement_productId_idx" ON "Entitlement" ("productId");` cho Admin lọc theo
  Product.

### JSONB

`grantSnapshot` (FR-006, cố định trong MVP):

```json
{ "schemaVersion": "1.0", "releaseAccess": "CURRENT_AND_SUPPORTED", "allowUpdates": true }
```

`auditHistory` — mảng, mỗi phần tử:

```json
{
  "action": "GRANT",
  "reason": "UAT cho tester",
  "actedAt": "2026-11-21T10:00:00.000Z",
  "actedById": "uuid-admin",
  "before": null,
  "after": {
    "status": "ACTIVE",
    "grantSource": "ADMIN_GRANT",
    "startsAt": "2026-11-21T10:00:00.000Z",
    "expiresAt": "2026-12-21T10:00:00.000Z"
  }
}
```

- `action ∈ GRANT | REVOKE`.
- `before`/`after` gồm `status`, `grantSource`, `startsAt`, `expiresAt`, và khi `REVOKED` thêm
  `revokedAt`, `revokedById`, `revokedReason` — đây là nơi giữ lịch sử thu hồi sau khi các cột revoke
  bị xoá về null (Clarification 2026-11-21).
- `before = null` khi grant tạo row mới.
- Mua hàng không append (FR-041).

## Chuyển trạng thái

```text
             Admin grant / Order activate               Admin revoke
(chưa có) ───────────────────────────────▶ ACTIVE ───────────────────▶ REVOKED
                                             ▲  │                         │
               Order activate (khi hết hạn)  │  │ thời gian trôi           │
               Admin grant (bất kỳ lúc nào)  └──┘ (EXPIRED chỉ là hiển thị) │
                                             ▲                            │
                                             └────── Admin grant ─────────┘
```

| Từ (hiển thị) | Sự kiện         | Điều kiện                        | Kết quả                                                       |
| ------------- | --------------- | -------------------------------- | ------------------------------------------------------------- |
| —             | Admin grant     | Product `ACTIVE`                 | INSERT `ACTIVE`, `ADMIN_GRANT`, audit `before = null`        |
| ACTIVE/EXPIRED| Admin grant     | Product `ACTIVE`                 | ghi đè kỳ, `ADMIN_GRANT`, audit                               |
| REVOKED       | Admin grant     | Product `ACTIVE`                 | `ACTIVE`, xoá revoke fields, audit giữ thông tin thu hồi      |
| ACTIVE/EXPIRED| Admin revoke    | —                                | `REVOKED` + revoke fields, giữ kỳ, audit                      |
| REVOKED       | Admin revoke    | —                                | từ chối `409`                                                 |
| — / EXPIRED   | Order activate  | quy tắc của spec 007             | INSERT/UPDATE `ACTIVE`, `ORDER`, `grantedById = null`, không audit |

## Quan hệ Prisma

`Entitlement` thêm relation vào `User` (customer, grantedBy, revokedBy — ba relation có tên),
`Product`, `ProductOffer`. Model Zod mirror ở `src/entities/entitlement.model.ts` (theo
`entities/product-offer.model.ts`).
