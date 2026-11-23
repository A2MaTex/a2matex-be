# Planning Notes: 008-studio-release

**Purpose**: ánh xạ kỹ thuật đã thống nhất khi viết spec, tách khỏi `spec.md` để spec chỉ mô tả
nghiệp vụ. Dùng làm đầu vào cho `/speckit-plan`. Không phải quyết định cuối — plan có thể điều
chỉnh kèm lý do.

**Source**: module `src/routes/launcher-release/` (7 file) và bảng `LauncherRelease`
(`prisma/schema.prisma:297`), đọc ngày 2026-11-23.

> **Đã bị thay thế một phần bởi [research.md](./research.md)** — khi mâu thuẫn, research/plan là
> nguồn đúng:
> - Nhận định "`cacheProvider` là dependency chết" là **sai**; `@DistributedLock` bắt buộc phải có
>   nó (R3).
> - Mức test, cách bắt trùng version, hình dạng route `deactivate`: xem R10, R1, R2.
> - Chữ ký controller: cả bốn method ghi nhận `@ActiveUser('userId')`, khác Launcher (R8).

## Data model

Bảng `StudioRelease`, sao chép `LauncherRelease` với đúng một khác biệt:

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | uuid PK | `gen_random_uuid()` |
| `version` | varchar(100) | **`@@unique`** — khác Launcher (FR-004) |
| `staticId` | uuid FK → `Static` | `onDelete: NoAction` |
| `releaseNotes` | text, nullable | |
| `isActive` | boolean, default false | |
| `publishedAt` | timestamptz, nullable | set lần kích hoạt đầu (FR-008) |
| `createdAt` / `updatedAt` / `deletedAt` | timestamptz | xoá mềm như Launcher |

- Unique đặt ở mức cột, **không** partial theo `deletedAt IS NULL`. Lý do: không route nào set
  `deletedAt` (không có endpoint xoá, giống Launcher), nên không có kịch bản "bản vô hình chiếm số
  phiên bản" sinh ra từ API. Partial index chỉ cần khi sau này thêm chức năng xoá bản phát hành.
  Nếu plan đảo quyết định này thì phải sửa cả Assumptions và Edge Cases của spec.
- `Static` cần thêm quan hệ ngược `studioReleases StudioRelease[]`.
- Không thêm index nào khác: Launcher không có index nào ngoài PK và khối lượng dữ liệu rất nhỏ
  (Constitution VI).

## Validation

- `version`: dùng lại `STRICT_SEMANTIC_VERSION_PATTERN` (đang dùng ở `src/entities/submission.model.ts:43`
  cho version của submission) + `SUBMISSION_RELEASE_VERSION_MAX_LENGTH` hoặc hằng tương đương. Đây
  là điểm **không** sao chép từ Launcher — Launcher nhận `z.string().trim().min(1).max(100)`.
- `STRICT_SEMANTIC_VERSION_PATTERN` là `/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/` — **không**
  nhận `-beta.1` hay `+build`. Đã ghi hệ quả này vào FR-003; nếu sau này cần kênh beta thì phải đổi
  cả pattern lẫn spec.
- `pageSize` cần trần (FR-022). Launcher không có trần: `getPagination` chỉ ép số nguyên dương nên
  `pageSize=1000000` đi lọt. Dùng `.max(100)` như `marketplace-product`.
- Phần còn lại giữ nguyên hình dạng schema của Launcher: input `.strict()`, update `.partial()` +
  `.refine()` bắt buộc ≥ 1 trường.

## Routes

| Method | Path | Auth | Ghi chú |
| --- | --- | --- | --- |
| GET | `/studio-releases/current` | `@IsPublic()` | FR-012, FR-013 |
| GET | `/studio-releases` | Admin | phân trang `page`/`pageSize`, sort `createdAt desc, id desc` |
| GET | `/studio-releases/:studioReleaseId` | Admin | |
| POST | `/studio-releases` | Admin | luôn `isActive: false` |
| PUT | `/studio-releases/:studioReleaseId` | Admin | partial |
| PUT | `/studio-releases/:studioReleaseId/activate` | Admin | `@DistributedLock` + `@Transactional` |
| PUT | `/studio-releases/:studioReleaseId/deactivate` | Admin | FR-021 — **mới**, Launcher không có |

Khoá phân tán: `useCase: 'activate_studio_release'` — tách khỏi khoá của Launcher. Deactivate dùng
chung khoá đó để hai thao tác không đè nhau.

### Đường tải: không làm gì thêm (FR-020)

Đã cân nhắc rồi bỏ: cho `current` trả kèm một presigned URL công khai. Chủ repo chốt giữ nguyên
như Launcher — tải tệp phải đăng nhập, dùng `GET /statics/files/:staticId` hoặc
`.../download-url` sẵn có. Vậy module này **không** động gì tới `static`, và output của `current`
giữ đúng hình dạng của Launcher.

Hệ quả cần biết khi làm Studio (không phải việc của backend trong spec này): chỉ có bước *kiểm tra
cập nhật* là công khai; bước tải đòi token, nên Studio phải đăng nhập trước khi cập nhật được. Đã
kiểm tra toàn bộ `@IsPublic()` trong repo ngày 2026-11-23: route tệp công khai duy nhất là
`GET /statics/images/:staticId`, chỉ phục vụ ảnh.

## Mã lỗi

Đặt tên song song với Launcher (`launcher-release.error.ts`):

| Tình huống | HTTP | Mã |
| --- | --- | --- |
| Không tìm thấy bản phát hành | 404 | `Error.StudioReleaseNotFound` |
| Không có bản hiệu lực | 404 | `Error.ActiveStudioReleaseNotFound` |
| Kích hoạt bản đang hiệu lực | 409 | `Error.StudioReleaseAlreadyActive` |
| `staticId` không tồn tại / đã xoá | 422 | `Error.StaticNotFound` (path `staticId`) |
| Trùng số phiên bản | 409 | `Error.StudioReleaseVersionTaken` — **mới**, Launcher không có |
| Gỡ hiệu lực bản không hiệu lực | 409 | `Error.StudioReleaseNotActive` — **mới** |
| Sửa `version`/`staticId` của bản đang hiệu lực | 409 | `Error.StudioReleaseActiveNotEditable` — **mới** (FR-016) |

Trùng version: bắt bằng unique constraint của DB rồi map lỗi Prisma `P2002`, hay kiểm tra trước khi
ghi — để plan quyết; nếu kiểm tra trước thì vẫn phải xử lý `P2002` vì có đua.

## File sẽ tạo

Gương của `src/routes/launcher-release/`: `studio-release.{controller,service,repo,model,dto,error,module}.ts`
+ `src/entities/studio-release.model.ts`, đăng ký `StudioReleaseModule` trong `src/app.module.ts`.

## Những chỗ KHÔNG sao chép từ Launcher

1. ~~`cacheProvider` là dependency chết~~ — **sai, đã kiểm lại**: `@DistributedLock` đọc
   `this.cacheProvider` lúc chạy (`distributed-lock.decorator.ts:46`) và ném lỗi nếu class không
   inject nó, y như `@Transactional` cần `this.transactionService`. Service của Studio **phải**
   inject cả `CACHE_PROVIDER` lẫn `TransactionService`, giống Launcher.
2. **`version` kiểu chuỗi tự do** — thay bằng semver nghiêm ngặt + unique (FR-003, FR-004).
3. **Không có test nào** — Launcher không có file `.spec.ts`. Mức đã chốt cho Studio: unit cho
   service (`activate` giữ đúng một bản hiệu lực và giữ `publishedAt` gốc, `deactivate`, trùng
   version, tệp đã xoá, chặn sửa bản đang hiệu lực) **và** một e2e chạy tạo → kích hoạt → truy vấn
   bản hiện hành trên DB local.
4. **Cho sửa thoải mái bản đang hiệu lực** — Studio khoá `version` và `staticId` khi `isActive`
   (FR-016). Lưu ý `update` của Launcher nhận thẳng `data` vào Prisma; bản Studio phải đọc trạng
   thái trước rồi mới quyết định.

## Migration & seed (Constitution III và II)

- Tạo migration bằng `prisma migrate dev --create-only`, commit cùng PR, chạy sạch trên DB rỗng.
- Chạy `prisma generate` lại; `src/generated/prisma` cũ sẽ làm `npm run build` lỗi TS2694.
- Trước khi kết luận migration đã áp dụng, đối chiếu bằng `prisma migrate diff` với
  `--from-config-datasource` — repo từng gặp trường hợp `migrate deploy` báo "up to date" trong khi
  DB thiếu cột.
- Sau khi thêm route: chạy `npm run seed:permissions` (seed quét controller, gán toàn bộ route cho
  role Admin) và invalidate cache role-permission.
- Mọi thao tác migrate/seed/test chạy trên container Postgres cục bộ, không chạm Cloud SQL.

## Đã chốt với chủ repo (2026-11-23, lượt 2)

- Tải tệp **phải đăng nhập**, không mở đường tải công khai.
- Bản đang hiệu lực chỉ sửa được ghi chú (FR-016).
- **Không** backport sang `launcher-release`; chấp nhận hai module khác hành vi một thời gian.
- Log **mọi** thao tác ghi, không chỉ activate (FR-019).
- Test: unit cho service + một e2e luồng chính.
- Trùng số phiên bản: **dựa vào unique constraint, bắt `P2002`**, không pre-check.
- `deactivate`: **route riêng** `PUT /studio-releases/:studioReleaseId/deactivate`, không gộp vào
  một route đổi trạng thái.

### Vì sao không pre-check trùng version

- Pre-check là TOCTOU: hai request cùng tạo `2.0.0` đều qua được `SELECT` rồi mới một cái đụng
  constraint. Nên pre-check không thay thế nhánh `P2002`, chỉ **thêm** một nhánh — và nhánh
  `P2002` còn lại gần như không bao giờ chạy, tức là nhánh duy nhất đúng lúc có đua lại là nhánh
  ít được kiểm chứng nhất.
- Đúng khuôn repo: `isUniqueConstraintPrismaError` ở `src/shared/utils/prisma.ts`, đang dùng ở
  `role.service.ts:44`, `order.service.ts:88`, `topup.service.ts:73`, `auth.service.ts:140`,
  `workflow-revision.service.ts:113`.
- Lý do phải bắt (thay vì để lọt): `catch-everything.filter.ts:44` đã map mọi `P2002` chưa bắt
  thành `409 "Record already exist"` — đúng mã HTTP nhưng không nói trùng cái gì. Bắt để ném
  `Error.StudioReleaseVersionTaken`.
- Bọc **cả** `create` lẫn `update` — sửa version sang giá trị đã tồn tại cũng ném `P2002`.
- Bảng chỉ có một unique (`version`) nên map thẳng là an toàn. Nếu sau này thêm unique thứ hai thì
  phải đọc `error.meta.target`, không thì mọi xung đột đều bị báo là trùng version.
- Mẫu test có sẵn: `workflow-revision.service.spec.ts:211` giả lập `PrismaClientKnownRequestError`
  code `P2002`.

### Vì sao `deactivate` là route riêng

- `StudioRelease` chỉ có cờ `isActive`, không phải máy trạng thái. Hai chỗ repo dùng route
  `lifecycle` đều có lý do mà ở đây không có: `product` có 3 hành động qua các trạng thái
  DRAFT–ACTIVE–ARCHIVED (`product.model.ts:166`), `product-release` thì hành động mang payload
  `reason` + `replacementReleaseId` (`product-release.model.ts:38`).
- Đọc song song với `launcher-release`: `activate` + `deactivate` là một cặp nhìn ra ngay.
- Seed tạo một permission cho mỗi cặp method+path, nên hai route riêng tách quyền được về sau mà
  không phải sửa code.
- `/:studioReleaseId/deactivate` có 3 đoạn, cùng hình dạng với `/activate`, nên không bị route
  `:studioReleaseId` (2 đoạn) nuốt — đúng bẫy mà `product-release-management.controller.ts:21`
  cảnh báo.
- Nếu sau này bản phát hành có thêm trạng thái thật (nháp / thu hồi / lưu trữ) thì chuyển sang
  `lifecycle` + enum; route admin nên đổi rẻ.

## Câu hỏi còn lại cho `/speckit-plan`

Không còn. Mọi quyết định đã chốt; plan chỉ cần lập data-model, contracts và tasks theo spec.
