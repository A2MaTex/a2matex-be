# Data Model: 008-studio-release

Nguồn: spec FR-001…FR-023; quyết định ở [research.md](./research.md) R3, R5, R11. Một migration
mới: `prisma/migrations/<timestamp>_add_studio_release/migration.sql` (tạo bằng
`npm run prisma:migrate:create`, viết tay nội dung, rồi `npm run prisma:generate`).

Không có enum mới. Không đổi bảng nào đang có ngoài một quan hệ ngược trên `Static`.

## Bảng `StudioRelease`

Bản sao của `LauncherRelease` (`prisma/schema.prisma:297`) với **một** khác biệt: unique trên
`version`.

| Cột | Kiểu | Null | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID PK | no | `gen_random_uuid()` |
| `version` | VARCHAR(100) | no | **UNIQUE** (R5); strict semver, validate ở tầng Zod (R4) |
| `staticId` | UUID FK → `Static("id")` | no | tệp cài đặt; `onDelete: NoAction` như Launcher |
| `releaseNotes` | TEXT | yes | ghi chú phát hành |
| `isActive` | BOOLEAN | no | default `false`; **partial unique index** giữ nhiều nhất một hàng `true` (FR-006, R13) |
| `publishedAt` | TIMESTAMPTZ(6) | yes | lần **đầu** kích hoạt; bất biến sau đó (FR-008, R11) |
| `createdAt` | TIMESTAMPTZ(6) | no | default `CURRENT_TIMESTAMP` |
| `updatedAt` | TIMESTAMPTZ(6) | yes | service set tay, như Launcher |
| `deletedAt` | TIMESTAMPTZ(6) | yes | không route nào set; giữ cho đồng bộ với các bảng khác (R5). Mọi truy vấn vẫn lọc `IS NULL` theo FR-018 |

### Migration

```sql
-- CreateTable
CREATE TABLE "StudioRelease" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "version" VARCHAR(100) NOT NULL,
    "staticId" UUID NOT NULL REFERENCES "Static"("id"),
    "releaseNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6)
);

-- CreateIndex
CREATE UNIQUE INDEX "StudioRelease_version_key" ON "StudioRelease"("version");

-- CreateIndex
-- Bất biến "nhiều nhất một bản hiệu lực" được DB giữ, không chỉ khoá phân tán (R13).
CREATE UNIQUE INDEX "StudioRelease_isActive_idx" ON "StudioRelease"("isActive") WHERE ("isActive" AND "deletedAt" IS NULL);
```

Ngoài hai unique index trên, không thêm index nào khác: bảng chỉ có vài chục hàng, danh sách luôn
quét toàn bảng rồi sắp theo `createdAt DESC` (Constitution VI). Không `CHECK` nào — ràng buộc semver thuộc tầng Zod vì thông
điệp lỗi phải là `Error.StudioReleaseVersionInvalid` cho client, không phải lỗi constraint thô.

### Prisma schema

```prisma
model StudioRelease {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  version      String    @unique @db.VarChar(100)
  staticId     String    @db.Uuid
  releaseNotes String?
  isActive     Boolean   @default(false) @unique(map: "StudioRelease_isActive_idx", where: raw("(\"isActive\" AND \"deletedAt\" IS NULL)"))
  publishedAt  DateTime? @db.Timestamptz(6)
  createdAt    DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt    DateTime? @db.Timestamptz(6)
  deletedAt    DateTime? @db.Timestamptz(6)
  static       Static    @relation(fields: [staticId], references: [id], onDelete: NoAction, onUpdate: NoAction)
}
```

Thêm một dòng vào `model Static`:

```prisma
  studioReleases     StudioRelease[]
```

## Bất biến dữ liệu

| # | Bất biến | Ai giữ |
| --- | --- | --- |
| 1 | Nhiều nhất một hàng `isActive = true` | **Partial unique index** là chốt chặn cuối; `activate` trong `@Transactional` + `@DistributedLock` tắt mọi hàng khác rồi mới bật hàng này nên đường thường không chạm tới constraint (FR-006, FR-007, R13) |
| 2 | `version` duy nhất | unique index; lỗi `P2002` map sang 409 (R1) |
| 3 | `publishedAt` chỉ ghi một lần | `activate` truyền `publishedAt ?? now`; `deactivate` không đụng tới (R11) |
| 4 | Bản `isActive` không đổi được `version`/`staticId` | `update` đọc trạng thái trước (R6) |
| 5 | `staticId` luôn trỏ tới `Static` chưa xoá mềm **tại thời điểm ghi** | `StaticRepository.findById` đã lọc `deletedAt: null`; sau đó tệp vẫn có thể bị xoá — lúc ấy `current` bỏ qua bản này (FR-013) |

## Truy vấn

| Dùng cho | Điều kiện |
| --- | --- |
| `current` | `isActive = true AND deletedAt IS NULL AND static.deletedAt IS NULL` (FR-013) |
| danh sách | `deletedAt IS NULL`, `ORDER BY createdAt DESC, id DESC`, phân trang (FR-014) — **không** lọc theo `static.deletedAt` (FR-023) |
| chi tiết | `id = ? AND deletedAt IS NULL`, kèm metadata tệp (FR-015, FR-023) |
| ngữ cảnh kích hoạt | `id = ? AND deletedAt IS NULL`, lấy `isActive`, `publishedAt`, `static.deletedAt` (FR-009, FR-010) |
