# Quickstart: kiểm chứng 008-studio-release

Hướng dẫn chạy và kiểm chứng end-to-end sau khi triển khai. Không chứa code triển khai.
Tham chiếu: [contracts/studio-release-api.md](./contracts/studio-release-api.md),
[data-model.md](./data-model.md), [research.md](./research.md).

## 1. Chuẩn bị

```bash
npm install
npm run compose-up
npm run prisma:migrate:deploy      # gồm migration add_studio_release
npm run prisma:generate            # BẮT BUỘC sau khi đổi schema, thiếu là build fail TS2694
npm run seed:roles
npm run seed:permissions           # quét cả 7 route mới, gán ADMIN, tự xoá cache role-permission
npm run build && npm run start:prod   # API: http://localhost:9999/api/v1
```

> Chạy API từ `dist` (`start:prod`). `start:dev` dùng `tsx` nên không emit decorator metadata ⇒ DTO
> không được validate và mọi kịch bản `422` ở dưới sẽ sai.

Lấy token admin:

```bash
ADMIN=$(curl -s -X POST localhost:9999/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"<admin-email>","password":"<password>"}' | jq -r '.data.accessToken')
```

Tạo hai tệp giả làm installer (nhỏ, để dùng upload một lần; tệp thật vượt
`STATIC_UPLOAD_MAX_SIZE_MB` phải đi đường multipart):

```bash
head -c 1048576 /dev/urandom > /tmp/studio-1.4.0.bin
head -c 1048576 /dev/urandom > /tmp/studio-1.5.0.bin

S140=$(curl -s -X POST localhost:9999/api/v1/statics/files/upload \
  -H "Authorization: Bearer $ADMIN" \
  -F 'file=@/tmp/studio-1.4.0.bin' -F 'prefix=studio/releases' | jq -r '.data.id')
S150=$(... tương tự với /tmp/studio-1.5.0.bin ...)
```

## 2. Kịch bản

Mỗi kịch bản ghi rõ FR mà nó chứng minh. `$R140`, `$R150` là id bản phát hành nhận được từ bước
tạo.

### S1 — Chưa có bản nào hiệu lực (FR-013)

```bash
curl -s localhost:9999/api/v1/studio-releases/current
```

Kỳ vọng `404 Error.ActiveStudioReleaseNotFound`. Gọi **không kèm token** — đây là điểm chứng minh
route công khai (FR-012).

### S2 — Tạo bản phát hành (FR-001, FR-002)

```bash
R140=$(curl -s -X POST localhost:9999/api/v1/studio-releases \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d "{\"version\":\"1.4.0\",\"staticId\":\"$S140\",\"releaseNotes\":\"Bản đầu\"}" | jq -r '.data.id')
```

Kỳ vọng `201` kèm `id`. Kiểm `GET /studio-releases/$R140` thấy `isActive: false`,
`publishedAt: null`.

### S3 — Validate số phiên bản và tệp (FR-003, FR-004, FR-005)

| Gửi | Kỳ vọng |
| --- | --- |
| `version: "1.4"` | 422, path `version` |
| `version: "v1.4.0"` | 422 |
| `version: "1.0.0-beta.1"` | 422 — pattern không nhận tiền phát hành (R4) |
| `version: "1.02.0"` | 422 — số 0 đứng đầu |
| `version: "1.4.0"` lần hai | **409** `Error.StudioReleaseVersionTaken` |
| `staticId` là UUID không tồn tại | 422 `Error.StaticNotFound`, path `staticId` |
| thêm khoá lạ `"foo": 1` | 422 `Unrecognized key` |

### S4 — Kích hoạt (FR-006, FR-008)

```bash
curl -s -X PUT localhost:9999/api/v1/studio-releases/$R140/activate -H "Authorization: Bearer $ADMIN"
curl -s localhost:9999/api/v1/studio-releases/current
```

Kỳ vọng `current` trả đúng `1.4.0`, `publishedAt` khác `null`. Gọi `activate` lần nữa → `409
Error.StudioReleaseAlreadyActive` (FR-009).

### S5 — Kích hoạt bản thứ hai, chỉ một bản hiệu lực (FR-006)

Tạo `1.5.0` với `$S150` rồi kích hoạt. Kỳ vọng `current` trả `1.5.0`; `GET /studio-releases` thấy
`1.4.0` có `isActive: false` nhưng **giữ nguyên** `publishedAt` cũ.

### S6 — Rollback xuống bản thấp hơn (FR-011)

Kích hoạt lại `$R140`. Kỳ vọng `200`, `current` trả `1.4.0`, và `publishedAt` của nó **không đổi**
so với S4 — đây là điểm dễ sai nhất của FR-008.

### S7 — Khoá bản đang hiệu lực (FR-016)

Với `$R140` đang hiệu lực:

| Gửi tới `PUT /studio-releases/$R140` | Kỳ vọng |
| --- | --- |
| `{"releaseNotes":"sửa mô tả"}` | 200, đọc lại thấy ghi chú mới |
| `{"version":"1.4.1"}` | 409 `Error.StudioReleaseActiveNotEditable` |
| `{"staticId":"$S150"}` | 409 `Error.StudioReleaseActiveNotEditable` |
| `{}` | 422 |

Sau hai lần 409, đọc lại bản ghi để chắc **không có gì bị ghi** (FR-016).

### S8 — Gỡ hiệu lực (FR-021)

```bash
curl -s -X PUT localhost:9999/api/v1/studio-releases/$R140/deactivate -H "Authorization: Bearer $ADMIN"
curl -s localhost:9999/api/v1/studio-releases/current
```

Kỳ vọng `current` trả `404` trở lại; `GET /studio-releases/$R140` vẫn thấy bản đó với
`publishedAt` cũ, `isActive: false`. Gọi `deactivate` lần nữa → `409
Error.StudioReleaseNotActive`.

### S9 — Tệp cài đặt bị xoá (FR-010, FR-013, FR-023)

Kích hoạt `$R150`, rồi xoá tệp của nó:

```bash
curl -s -X DELETE localhost:9999/api/v1/statics/$S150 -H "Authorization: Bearer $ADMIN"
curl -s localhost:9999/api/v1/studio-releases/current
```

Kỳ vọng: `current` trả `404` dù `$R150` vẫn `isActive = true` trong DB (FR-013);
`GET /studio-releases` **vẫn hiện** `1.5.0`, và `GET /studio-releases/$R150` vẫn trả `200` kèm
nguyên metadata tệp, để Admin thấy mà xử lý (FR-023). Sau đó gỡ hiệu lực
`$R150` rồi kích hoạt lại chính nó → `422 Error.StaticNotFound`, vì không được công bố một bản trỏ
tới tệp đã xoá (FR-010).

> Thao tác xoá này là một chiều: `deleteStatic` xoá object khỏi kho lưu trữ **trước** khi đánh dấu
> xoá bản ghi. Chạy trên dữ liệu local thôi.

### S10 — Phân trang (FR-014, FR-022)

| Gọi | Kỳ vọng |
| --- | --- |
| `GET /studio-releases` | mặc định `pageSize: 10`, sắp `createdAt` giảm dần |
| `GET /studio-releases?pageSize=100` | 200 |
| `GET /studio-releases?pageSize=101` | **422** |
| `GET /studio-releases?pageSize=0` | 422 |

### S11 — Phân quyền (FR-017)

| Gọi | Kỳ vọng |
| --- | --- |
| `GET /studio-releases` không token | 401 |
| `GET /studio-releases` với token customer | 403 |
| `GET /studio-releases/current` không token | 200 hoặc 404 tuỳ trạng thái, **không bao giờ** 401 |

### S12 — Tải tệp vẫn cần đăng nhập (FR-020)

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:9999/api/v1/statics/files/$S140
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ADMIN" \
  localhost:9999/api/v1/statics/files/$S140
```

Kỳ vọng `401` rồi `200`. Đây là ràng buộc đã chốt, không phải lỗi.

### S13 — Nhật ký (FR-019)

Xem log của tiến trình API khi chạy lại S2, S4, S7, S8: mỗi thao tác ghi phải có một dòng kèm
`studioReleaseId` và id người thực hiện.

### S14 — Bản xoá mềm biến mất (FR-018)

Không có route nào xoá bản phát hành, nên kịch bản này đặt cờ thẳng trên DB local:

```sql
UPDATE "StudioRelease" SET "deletedAt" = now() WHERE id = '<R140>';
```

Kỳ vọng: `GET /studio-releases` không còn `1.4.0`; `GET /studio-releases/<R140>` trả `404`; nếu bản
đó đang hiệu lực thì `GET /studio-releases/current` cũng trả `404`. Nhớ `UPDATE ... SET
"deletedAt" = NULL` để trả lại trạng thái trước khi chạy tiếp.

### S15 — Hai Admin kích hoạt đồng thời (FR-007, SC-003)

Bất biến "nhiều nhất một bản hiệu lực" chỉ được chứng minh khi có đua thật:

```bash
curl -s -X PUT $API/studio-releases/$RA/activate -H "$AUTH" &
curl -s -X PUT $API/studio-releases/$RB/activate -H "$AUTH" &
wait
```

```sql
SELECT count(*) FROM "StudioRelease" WHERE "isActive" = true;   -- phải là 1
```

Kỳ vọng: một request `200`, request kia `409` (thông điệp chung của khoá phân tán, không phải
`Error.StudioReleaseAlreadyActive`). Chạy lặp vài lượt, mỗi lượt đặt lại `isActive = false` cho
toàn bảng rồi đua tiếp.

Chốt chặn cuối nằm ở DB — kiểm riêng bằng SQL, không qua API:

```sql
INSERT INTO "StudioRelease" (version,"staticId","isActive") VALUES ('6.0.1','<staticId>',true);
INSERT INTO "StudioRelease" (version,"staticId","isActive") VALUES ('6.0.2','<staticId>',true);
-- câu thứ hai phải lỗi: duplicate key ... "StudioRelease_isActive_idx"
```

## 3. Chạy test tự động

```bash
npm run lint
npm test                 # unit, gồm src/routes/studio-release/test/
npm run test:e2e         # cần DB local đang chạy và đã seed
```

`npm test` dùng `vitest.config.ts` với `include: ['**/*.spec.ts']` nên **không** chạy
`*.e2e-spec.ts`; e2e là lệnh riêng và không nằm trong cổng chất lượng của CI (R10).

## 4. Dọn dẹp

```sql
DELETE FROM "StudioRelease";
-- các bản ghi Static đã tạo ở bước chuẩn bị: xoá qua API DELETE /statics/:staticId
```
