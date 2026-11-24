# Data Model: Chia tiền bán hàng (phase 2)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Quyết định**: [research.md](./research.md)

Không có bảng mới. Phase này thêm bốn cột vào bảng đơn hàng và một index.

## 1. Bốn cột thêm vào `Order`

```text
Order.publisherUserId     UUID FK User, required
Order.commissionRateBps   INTEGER, required, 0..10000
Order.commissionAmount    BIGINT, required, >= 0
Order.publisherAmount     BIGINT, required, >= 0
```

Ghi một lần lúc mua, không có đường sửa — `Order` vốn đã bất biến, không có `updatedAt` và không có
xoá mềm.

### Vì sao lưu `publisherUserId` dù suy ra được

Hiện có thể đi `productId → Product.publisherAccountId → PublisherAccount.userId`. Nhưng quyền sở
hữu sản phẩm là thứ đổi được, còn một đơn hàng phải **mãi mãi truy ra đúng người đã thực nhận
tiền** (FR-015). Suy ra lúc đọc sẽ trả về chủ sở hữu *hiện tại*, không phải người đã nhận.

### Vì sao lưu cả `commissionRateBps` lẫn hai số tiền

Tỉ lệ là thứ quản trị viên đổi được bất cứ lúc nào. Lưu tỉ lệ để giải thích được con số; lưu hai số
tiền để không phải tính lại (và không thể tính lại sai). Đây cùng một lý do với `offerSnapshot` đã
có sẵn trên đơn hàng.

### Đơn vị `rateBps`

Basis point, số nguyên: `3000` = 30%, `10000` = 100%. Không dùng số thực ở bất kỳ đâu trong đường
tính tiền — lý do đã đo ở [research.md](./research.md) R3.

## 2. Bất biến

- `commissionAmount + publisherAmount = totalAmount`, **chính xác**, với mọi đơn.
- `commissionAmount >= 0` và `publisherAmount >= 0`.
- `commissionRateBps` trong `[0, 10000]`.
- `publisherUserId` luôn khác `customerId` với đơn **mới** (chặn tự mua). Đơn cũ có thể vi phạm —
  đã tồn tại 2 đơn như vậy — nên **không** đặt ràng buộc này ở tầng dữ liệu.

## 3. Hợp đồng SQL

Ba bước trong **cùng một file migration**, theo thứ tự này. Ràng buộc tổng-phải-khớp chỉ được thêm
sau khi điền xong, nếu không chính bước điền sẽ vi phạm nó.

```sql
-- Bước 1: thêm cột, cho phép NULL tạm thời
ALTER TABLE "Order"
    ADD COLUMN "publisherUserId" UUID REFERENCES "User" (id) ON DELETE NO ACTION,
    ADD COLUMN "commissionRateBps" INTEGER,
    ADD COLUMN "commissionAmount" BIGINT,
    ADD COLUMN "publisherAmount" BIGINT;

-- Bước 2: điền cho đơn đã tồn tại. Xem mục 4 — nội dung phụ thuộc quyết định chưa chốt.

-- Bước 3: siết lại
ALTER TABLE "Order"
    ALTER COLUMN "publisherUserId" SET NOT NULL,
    ALTER COLUMN "commissionRateBps" SET NOT NULL,
    ALTER COLUMN "commissionAmount" SET NOT NULL,
    ALTER COLUMN "publisherAmount" SET NOT NULL,
    ADD CONSTRAINT "Order_commissionRateBps_check"
        CHECK ("commissionRateBps" >= 0 AND "commissionRateBps" <= 10000),
    ADD CONSTRAINT "Order_split_exact_check"
        CHECK ("commissionAmount" >= 0
           AND "publisherAmount" >= 0
           AND "commissionAmount" + "publisherAmount" = "totalAmount");

CREATE INDEX "Order_publisherUserId_createdAt_idx"
ON "Order" ("publisherUserId", "createdAt" DESC);
```

`Order_split_exact_check` là thứ làm FR-002 đúng ở **mọi** đường ghi, kể cả SQL trực tiếp không qua
ứng dụng — khác với tỉ lệ hoa hồng ở phase 1, ở đây ràng buộc bao được trọn vẹn vì cả ba giá trị
đều là cột thật chứ không nằm trong JSON.

## 4. Chuyển đổi dữ liệu cũ

**Đã chốt 2026-11-23**: cả 5 đơn trên production là giao dịch thử của chủ repo, không phải khách
thật. Một luật duy nhất cho mọi đơn đã tồn tại, không chia nhóm, không đụng ví.

```sql
-- Bước 2 của migration: điền cho đơn đã tồn tại.
-- Toàn bộ ghi về phía sàn vì chưa đồng nào từng chạy vào ví nhà phát hành cho những đơn này.
-- Ghi một tỉ lệ khác sẽ đóng băng vào lịch sử một con số chưa bao giờ xảy ra.
UPDATE "Order" o
SET "publisherUserId"   = pa."userId",
    "commissionRateBps" = 10000,
    "commissionAmount"  = o."totalAmount",
    "publisherAmount"   = 0
FROM "Product" p
JOIN "PublisherAccount" pa ON pa.id = p."publisherAccountId"
WHERE p.id = o."productId"
  AND o."publisherUserId" IS NULL;
```

Không có câu `UPDATE "Profile"` nào. Điều kiện `publisherUserId IS NULL` làm câu lệnh chạy lại
không đổi gì thêm.

Hai trong năm đơn là nhà phát hành tự mua sản phẩm của mình. Với luật hiện tại thì chúng nhận cùng
cách xử lý như các đơn khác, nên không cần nhánh riêng — nhưng FR-016b vẫn tồn tại để chặn đúng chỗ
nếu luật chung về sau được đổi ở một môi trường khác.

## 5. Mô hình Prisma

```prisma
model Order {
  // ... các trường hiện có
  publisherUserId   String @db.Uuid
  commissionRateBps Int
  commissionAmount  BigInt
  publisherAmount   BigInt
  publisher         User   @relation("OrderPublisher", fields: [publisherUserId], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@index([publisherUserId, createdAt(sort: Desc)], map: "Order_publisherUserId_createdAt_idx")
}
```

`User` nhận thêm quan hệ ngược `publisherOrders Order[] @relation("OrderPublisher")`.

Theo quy trình SQL-first: viết migration trước, áp dụng, rồi sửa `schema.prisma` **bằng tay** cho
khớp và chạy `prisma:generate`. **Không introspect** — database local có sẵn drift
(`Static.publisherAccountId`) và introspect sẽ kéo nó vào schema.

## 6. Phép tính chia tiền

```text
rateBps          = đọc từ kho cấu hình, số nguyên 0..10000
commissionAmount = (totalAmount * rateBps) / 10000      // BigInt, cắt phần dư
publisherAmount  = totalAmount - commissionAmount
```

Tính phần nhà phát hành bằng **phép trừ** là thứ làm tổng luôn khớp tuyệt đối. Nhân hai lần rồi
cộng lại sẽ lệch khi không chia hết.

Một vài giá trị để kiểm:

| totalAmount | rateBps | commissionAmount | publisherAmount | tổng |
|------------:|--------:|-----------------:|----------------:|-----:|
| 100.000 | 3000 | 30.000 | 70.000 | ✓ |
| 100.005 | 3000 | 30.001 | 70.004 | ✓ |
| 100 | 2900 | 29 | 71 | ✓ |
| 2.000 | 3000 | 600 | 1.400 | ✓ |
| 1 | 3000 | 0 | 1 | ✓ |
| 99.000 | 0 | 0 | 99.000 | ✓ |
| 99.000 | 10000 | 99.000 | 0 | ✓ |
| 0 | 3000 | 0 | 0 | ✓ |

Hàng `100 / 2900` là ca mà số thực cho ra 28 thay vì 29.

## 7. Quan hệ với thực thể có sẵn

- **`User`** — thêm một quan hệ, `publisherUserId`, để truy người đã nhận tiền.
- **`Profile`** — không đổi cấu trúc. Chỉ có thêm một đường **ghi** vào `balance` (cộng cho nhà
  phát hành) bên cạnh hai đường đã có (nạp tiền cộng, mua hàng trừ).
- **`Product`, `ProductOffer`, `Entitlement`** — không đổi. Đơn hàng vẫn trỏ tới chúng như cũ.
