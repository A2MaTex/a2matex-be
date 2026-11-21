# Quickstart: kiểm chứng 006-entitlement

Hướng dẫn chạy và kiểm chứng end-to-end sau khi triển khai. Không chứa code triển khai.
Tham chiếu: [contracts/entitlement-api.md](./contracts/entitlement-api.md),
[data-model.md](./data-model.md).

## 1. Chuẩn bị

```bash
npm install
npm run compose-up
npm run prisma:migrate:deploy      # gồm migration add_entitlement
npm run prisma:generate
npm run seed:roles
npm run seed:permissions           # quét 4 route mới, gán ADMIN, tự xoá cache role-permission
npm run start:dev                  # API: http://localhost:9999/api/v1
```

Gán `GET /api/v1/entitlements/me` cho role `CUSTOMER` (bước vận hành, research R6):

1. `GET /api/v1/permissions` (token admin) → lấy `id` của permission `GET /api/v1/entitlements/me`.
2. `GET /api/v1/roles/:customerRoleId/permissions` → lấy danh sách id hiện có.
3. `PUT /api/v1/roles/:customerRoleId/permissions` với `permissionIds` = danh sách hiện có **+** id
   mới. API này **thay toàn bộ** tập permission của role — thiếu id cũ là mất quyền của customer.

Dữ liệu cần có: một tài khoản admin (`$ADMIN`), hai customer (`$C1`, `$C2` — access token, kèm
`$C1_ID`), một Product `ACTIVE` (`$P_ACTIVE`) và một Product `DRAFT` (`$P_DRAFT`).

```bash
API=http://localhost:9999/api/v1
```

## 2. Kịch bản

### S1 — Admin cấp quyền lần đầu (Story 1, AS1)

```bash
curl -sX POST $API/admin/entitlements/grant -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' \
  -d "{\"customerId\":\"$C1_ID\",\"productId\":\"$P_ACTIVE\",\"expiresAt\":\"2027-01-01T00:00:00Z\",\"reason\":\"UAT\"}"
```

Kỳ vọng `200`, `status=ACTIVE`, `grantSource=ADMIN_GRANT`, `grantedById` = admin, `auditHistory`
có 1 entry `GRANT` với `before=null`. Gọi `GET $API/entitlements/me` bằng `$C1` → thấy Product, không
có field revoke/audit.

### S2 — Từ chối cấp quyền (Story 1, AS5–6)

| Request                                  | Kỳ vọng                                 |
| ---------------------------------------- | --------------------------------------- |
| `productId=$P_DRAFT`                     | `409 Error.EntitlementProductNotActive` |
| `expiresAt` ở quá khứ                    | `422 Error.EntitlementInvalidExpiresAt` |
| Bỏ hẳn trường `expiresAt`                | `422` validation                        |
| `reason: "   "`                          | `422` validation                        |
| `customerId` ngẫu nhiên                  | `404 Error.EntitlementCustomerNotFound` |

Sau mỗi request: `SELECT count(*) FROM "Entitlement"` không đổi.

### S3 — Ghi đè rút ngắn thời hạn (Story 1, AS3; Clarification lựa chọn 2)

Grant lại cho `$C1`/`$P_ACTIVE` với `expiresAt` gần hơn S1 → `200`, `expiresAt` mới, `startsAt` =
thời điểm cấp, cùng `id` với S1; `auditHistory` có 2 entry, entry 2 có `before.expiresAt` = giá trị S1.

### S4 — Vĩnh viễn (Story 1, AS4)

Grant với `"expiresAt": null` → `expiresAt=null`, My Products hiển thị `ACTIVE`.

### S5 — Hết hạn suy ra lúc đọc (Story 2, AS2)

```sql
UPDATE "Entitlement" SET "startsAt" = now() - interval '2 day', "expiresAt" = now() - interval '1 day'
WHERE "customerId" = '<C1_ID>' AND "productId" = '<P_ACTIVE>';
```

My Products → `status=EXPIRED` trong khi cột `status` vẫn là `ACTIVE`.

### S6 — Thu hồi và cấp lại (Story 3)

1. `POST $API/admin/entitlements/<id>/revoke` `{"reason":"vi phạm"}` → `200`, `status=REVOKED`, đủ
   ba revoke fields, `expiresAt` giữ nguyên.
2. Revoke lần nữa → `409 Error.EntitlementAlreadyRevoked`.
3. My Products của `$C1` → `REVOKED`, không có lý do/người thu hồi.
4. Grant lại → `ACTIVE`, ba revoke fields = `null`; `auditHistory` vẫn chứa entry `REVOKE` với lý do.
5. Revoke id ngẫu nhiên → `404 Error.EntitlementNotFound`.

### S7 — Cô lập dữ liệu (Story 2, AS4; FR-052)

- `GET /entitlements/me` bằng `$C2` → không thấy quyền của `$C1`.
- `$C1` gọi `GET /admin/entitlements` hoặc `POST /admin/entitlements/grant` → `403`.

### S8 — Admin tra cứu (Story 4)

`GET $API/admin/entitlements?customerId=$C1_ID` → có quyền của `$C1` với đủ field quản trị;
`?productId=<không phải uuid>` → `422`.

## 3. Ràng buộc dữ liệu (FR-005, SC-003, SC-004)

Chạy trực tiếp trên DB, mỗi lệnh phải **bị từ chối**:

```sql
-- ACTIVE mang revoke fields
UPDATE "Entitlement" SET "revokedReason" = 'x' WHERE status = 'ACTIVE';
-- REVOKED thiếu revoke fields
UPDATE "Entitlement" SET status = 'REVOKED' WHERE "revokedAt" IS NULL;
-- trùng (customer, product)
INSERT INTO "Entitlement" ("customerId","productId","grantSource","startsAt","grantSnapshot")
SELECT "customerId","productId",'ORDER',now(),'{}' FROM "Entitlement" LIMIT 1;
-- expiresAt trước startsAt
UPDATE "Entitlement" SET "expiresAt" = "startsAt" - interval '1 day';
```

## 4. Đồng thời (Edge case, SC-003)

Gửi song song 10 request grant cho cùng một customer mới và `$P_ACTIVE`:

```bash
for i in $(seq 10); do
  curl -sX POST $API/admin/entitlements/grant -H "Authorization: Bearer $ADMIN" \
    -H 'Content-Type: application/json' \
    -d "{\"customerId\":\"$C2_ID\",\"productId\":\"$P_ACTIVE\",\"expiresAt\":null,\"reason\":\"race $i\"}" &
done; wait
```

Kỳ vọng: tất cả `200` (hoặc `503` nếu chờ khoá quá lâu), đúng **1** row cho cặp đó,
`jsonb_array_length("auditHistory")` = số request `200`.

## 5. Contract nội bộ (FR-010, FR-011)

Kiểm chứng bằng unit test trong `src/routes/entitlement/test/` (`npm test`):

- `checkUsage`: `NOT_FOUND`, `REVOKED` (kể cả `expiresAt` null hoặc tương lai), `EXPIRED`,
  `PRODUCT_SUSPENDED`, `PRODUCT_UNAVAILABLE`, `usable` khi Product `ARCHIVED`.
- `activateFromOrder`: tạo mới; kích hoạt lại row hết hạn với kỳ từ `now`; `ONE_TIME` set
  `oneTimePurchasedAt` lần đầu và không ghi đè lần sau; không append `auditHistory`.

## 6. Cổng chất lượng

```bash
npm run lint && npm test && npm run build
```
