# Contract: Entitlement API

Prefix `API_PREFIX_PATH` như mọi route khác. Tất cả route cần Bearer access token
(`AccessTokenGuard`) và permission record (Constitution II, [research.md](../research.md) R6).
DTO dùng `nestjs-zod`; lỗi theo envelope NestJS hiện có `{ message, error, statusCode }`.
Thời gian là ISO 8601 UTC.

Kiểu dùng chung:

```ts
type EffectiveStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED'; // FR-004, tính bằng now() của DB
type GrantSource = 'ORDER' | 'ADMIN_GRANT';
type Page<T> = { items: T[]; totalItems: number; page: number; pageSize: number; totalPages: number };
```

Query phân trang: `page` (mặc định 1), `limit` (mặc định 10) — `PaginationQuerySchema`.

---

## 1. `GET /entitlements/me` — My Products (FR-050)

Actor: user đăng nhập (permission gán cho role `CUSTOMER`). Chỉ trả quyền của `userId` trong token.

Query: `page`, `limit`. Sắp xếp `startsAt DESC, id ASC`.

`200`:

```ts
Page<{
  id: string;
  status: EffectiveStatus;
  grantSource: GrantSource;
  startsAt: string;
  expiresAt: string | null;
  product: { id: string; name: string | null; slug: string | null; status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' };
  publisher: { username: string; displayName: string };
}>
```

Không trả: `revokedAt`, `revokedById`, `revokedReason`, `grantedById`, `auditHistory`,
`latestOrderId`, `latestProductOfferId`, `oneTimePurchasedAt`, `grantSnapshot`.

`publisher.displayName` = `Profile.fullName` của chủ Publisher (giống Marketplace).

---

## 2. `GET /admin/entitlements` — Admin tra cứu (FR-051)

Actor: role `ADMIN`.

Query: `page`, `limit`, `customerId?` (uuid), `productId?` (uuid). Sắp xếp `updatedAt DESC NULLS
LAST, createdAt DESC, id ASC`.

`200`: `Page<AdminEntitlement>`

```ts
type AdminEntitlement = {
  id: string;
  customerId: string;
  productId: string;
  status: EffectiveStatus;
  storedStatus: 'ACTIVE' | 'REVOKED';
  grantSource: GrantSource;
  grantedById: string | null;
  startsAt: string;
  expiresAt: string | null;
  latestProductOfferId: string | null;
  latestOrderId: string | null;   // 2026-11-23: đổi tên từ latestOrderItemId (spec 007 bỏ OrderItem)
  oneTimePurchasedAt: string | null;
  revokedAt: string | null;
  revokedById: string | null;
  revokedReason: string | null;
  auditHistory: Array<{
    action: 'GRANT' | 'REVOKE';
    reason: string;
    actedAt: string;
    actedById: string;
    before: EntitlementStateSnapshot | null;
    after: EntitlementStateSnapshot;
  }>;
  createdAt: string;
  updatedAt: string | null;
};
```

| Điều kiện                           | Kết quả                 |
| ----------------------------------- | ----------------------- |
| `customerId`/`productId` không uuid | `422` validation error  |

---

## 3. `POST /admin/entitlements/grant` — Admin cấp quyền (FR-020–022)

Actor: role `ADMIN`.

Body (strict):

```ts
{
  customerId: string;          // uuid
  productId: string;           // uuid
  expiresAt: string | null;    // bắt buộc có mặt; null = vĩnh viễn
  reason: string;              // trim, 1..2000
}
```

`200`: `AdminEntitlement` sau khi cấp (`status = 'ACTIVE'`, `grantSource = 'ADMIN_GRANT'`).

| Điều kiện                                                  | Kết quả                                   | Thay đổi |
| ---------------------------------------------------------- | ----------------------------------------- | -------- |
| Body sai định dạng / thiếu `expiresAt` / reason rỗng       | `422` validation error                    | không    |
| Product không tồn tại hoặc đã xoá                          | `404 Error.ProductNotFound`               | không    |
| Product không `ACTIVE`                                     | `409 Error.EntitlementProductNotActive`   | không    |
| Customer không tồn tại, đã xoá, hoặc không có Profile      | `404 Error.EntitlementCustomerNotFound`   | không    |
| `expiresAt ≤ now()` của transaction                        | `422 Error.EntitlementInvalidExpiresAt`   | không    |
| Hết thời gian chờ khoá                                     | `503 Error.EntitlementOperationTimeout`   | rollback |

Thứ tự kiểm tra theo thứ tự khoá (R5): Product → customer → `expiresAt`.

---

## 4. `POST /admin/entitlements/:entitlementId/revoke` — Admin thu hồi (FR-030–033)

Actor: role `ADMIN`.

Param: `entitlementId` (uuid). Body (strict): `{ reason: string }` (trim, 1..2000).

`200`: `AdminEntitlement` sau khi thu hồi (`status = 'REVOKED'`).

| Điều kiện                       | Kết quả                                 | Thay đổi |
| ------------------------------- | --------------------------------------- | -------- |
| Param/body sai định dạng        | `422` validation error                  | không    |
| Entitlement không tồn tại       | `404 Error.EntitlementNotFound`         | không    |
| Entitlement đã `REVOKED`        | `409 Error.EntitlementAlreadyRevoked`   | không    |
| Hết thời gian chờ khoá          | `503 Error.EntitlementOperationTimeout` | rollback |

Thu hồi không phụ thuộc trạng thái Product.

---

## 5. Contract nội bộ (không phải HTTP)

Export từ `EntitlementModule` → `EntitlementService`. Chi tiết và lý do: [research.md](../research.md)
R2, R7.

```ts
type UsageCheck =
  | { usable: true; entitlementId: string }
  | {
      usable: false;
      reason: 'NOT_FOUND' | 'REVOKED' | 'EXPIRED' | 'PRODUCT_UNAVAILABLE' | 'PRODUCT_SUSPENDED';
    };

checkUsage(input: { customerId: string; productId: string }): Promise<UsageCheck>;

// Chỉ gọi trong transaction của Order, sau khi đã khoá Product → Offer → Profile.
lockForPurchase(input: { customerId: string; productId: string }): Promise<{
  id: string;
  status: 'ACTIVE' | 'REVOKED';
  expiresAt: Date | null;
  oneTimePurchasedAt: Date | null;
} | null>;

activateFromOrder(input: {
  customerId: string;
  productId: string;
  orderItemId: string;
  productOfferId: string;
  offerType: 'ONE_TIME' | 'SUBSCRIPTION';
  durationDays: number | null;
  now: Date; // transactionNow của Order
}): Promise<{ id: string; startsAt: Date; expiresAt: Date | null }>;
```

`PRODUCT_UNAVAILABLE` = Product đã bị xoá. Product `ARCHIVED` vẫn `usable` (FR-010).
