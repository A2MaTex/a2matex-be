# Research: 008-studio-release

Đầu vào: [spec.md](./spec.md) (23 FR), [planning-notes.md](./planning-notes.md), mã nguồn
`src/routes/launcher-release/` đọc ngày 2026-11-23. Mọi quyết định nghiệp vụ đã chốt với chủ repo
trong Clarifications của spec; phần dưới là các quyết định kỹ thuật và chứng cứ trong repo.

## R1 — Bắt trùng số phiên bản bằng `P2002`, không pre-check

**Decision**: để unique constraint của DB là nguồn sự thật; bọc `create` và `update` bằng
`try/catch`, dùng `isUniqueConstraintPrismaError` (`src/shared/utils/prisma.ts`) rồi ném
`StudioReleaseVersionTakenException` (409).

**Rationale**: pre-check là TOCTOU — hai request cùng tạo `2.0.0` đều qua `SELECT` rồi vẫn một cái
đụng constraint, nên pre-check **thêm** một nhánh chứ không bỏ được nhánh `P2002`; nhánh `P2002`
khi đó gần như không bao giờ chạy, tức nhánh duy nhất đúng lúc có đua lại là nhánh ít được kiểm
chứng nhất. Repo đã có đúng khuôn này ở `role.service.ts:44`, `order.service.ts:88`,
`topup.service.ts:73`, `auth.service.ts:140`, `workflow-revision.service.ts:113`.

**Alternatives considered**: pre-check rồi vẫn bắt `P2002` (hai nhánh, không thêm độ an toàn);
không bắt gì — `catch-everything.filter.ts:44` vẫn trả `409 "Record already exist"` nhưng không nói
trùng cái gì, đúng vấn đề mà comment ở `auth.service.ts:413` đã ghi.

**Lưu ý triển khai**: bảng chỉ có một unique (`version`) nên map thẳng là an toàn; nếu sau này thêm
unique thứ hai thì phải đọc `error.meta.target`. Mẫu test giả lập `PrismaClientKnownRequestError`
code `P2002`: `workflow-revision.service.spec.ts:211`.

## R2 — `deactivate` là route riêng

**Decision**: `PUT /studio-releases/:studioReleaseId/deactivate`, không gộp vào route đổi trạng
thái.

**Rationale**: `StudioRelease` chỉ có cờ `isActive`, không phải máy trạng thái. Hai chỗ repo dùng
route `lifecycle` đều có lý do mà ở đây không có: `product` có ba hành động qua DRAFT–ACTIVE–
ARCHIVED (`product.model.ts:166`), `product-release` thì hành động mang payload `reason` +
`replacementReleaseId` (`product-release.model.ts:38`). Thêm nữa, seed tạo một permission cho mỗi
cặp method+path nên hai route riêng tách quyền được về sau mà không phải sửa code.

**Alternatives considered**: `PUT /:id/lifecycle` + enum — hợp lý khi bản phát hành có thêm trạng
thái thật (nháp / thu hồi / lưu trữ); lúc đó chuyển sang vẫn rẻ vì là route admin.

## R3 — `@DistributedLock` và `@Transactional` bắt buộc inject hai provider

**Decision**: `StudioReleaseService` inject đủ `CACHE_PROVIDER` (tên thuộc tính `cacheProvider`) và
`TransactionService` (tên thuộc tính `transactionService`), y như `LauncherReleaseService`.

**Rationale**: hai decorator đọc thuộc tính của instance lúc chạy và ném lỗi nếu thiếu —
`distributed-lock.decorator.ts:46` (`@DistributedLock requires ... to inject CacheProvider as
cacheProvider`) và `transactional.decorator.ts:22`. Tên thuộc tính là một phần của hợp đồng, đổi
tên là hỏng lúc chạy chứ không phải lúc biên dịch.

**Ghi chú**: nhận định trước đó trong `planning-notes.md` rằng `cacheProvider` của Launcher là
"dependency chết" là **sai**; đã sửa tại chỗ.

## R4 — Nguồn của pattern semver

**Decision**: import `STRICT_SEMANTIC_VERSION_PATTERN` từ
`src/routes/node-catalog/node-catalog.constant.ts:69`.

**Rationale**: đã có tiền lệ import xuyên module cho đúng hằng này —
`workflow-compiler.model.ts:11`. Nhân bản regex sang chỗ khác là hai nguồn sự thật cho cùng một
định dạng.

**Alternatives considered**: chuyển hằng sang `src/shared/constants/` — sạch hơn về mặt phân lớp
nhưng đụng vào hai module đang chạy, không thuộc phạm vi spec này (Constitution VI).

**Hệ quả đã ghi vào FR-003**: pattern là `/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/` — không
nhận `1.0.0-beta.1`, `1.0.0+build`, hay `1.02.0`.

**`Error.StudioReleaseVersionInvalid` không phải exception class**: nó là chuỗi truyền vào
`.regex(PATTERN, { message })` trong `studio-release.model.ts`, do `CustomZodValidationPipe` dựng
thành 422 kèm `path: 'version'` — giống cách `submission.model.ts:46` đặt
`Error.SubmissionVersionInvalid`. Chỉ 7 exception thật nằm trong `studio-release.error.ts`.

## R5 — Unique ở mức cột, giữ nguyên bộ cột xoá mềm

**Decision**: `@@unique([version])` mức cột (không partial theo `deletedAt IS NULL`); vẫn giữ
`createdAt` / `updatedAt` / `deletedAt` như `LauncherRelease`.

**Rationale**: không route nào set `deletedAt` (không có chức năng xoá — spec Out of Scope) nên
không sinh ra cảnh "bản vô hình chiếm mất số phiên bản" từ API. Giữ bộ cột xoá mềm vì **mọi** bảng
khác trong `schema.prisma` đều có; bỏ đi sẽ là ngoại lệ phải giải thích, trong khi chi phí chỉ là
một điều kiện `deletedAt: null` trong `where`.

**Alternatives considered**: partial unique index — chỉ cần khi sau này thêm chức năng xoá bản phát
hành; khi đó sửa cùng lúc với Assumptions và Edge Cases của spec.

## R6 — Khoá bất biến bản đang hiệu lực

**Decision**: `update` đọc trạng thái bản trước, nếu `isActive` và payload có `version` hoặc
`staticId` thì ném `StudioReleaseActiveNotEditableException` (409); chỉ `releaseNotes` được đi qua.

**Rationale**: FR-016. Không làm được bằng `updateMany` có điều kiện vì cần phân biệt "không tồn
tại" (404) với "đang hiệu lực nên bị khoá" (409).

**Khác Launcher**: `LauncherReleaseRepo.update` đẩy thẳng `...data` vào Prisma sau khi service chỉ
kiểm tra tồn tại; bản Studio phải đọc `isActive` trong cùng bước kiểm tra đó.

## R7 — Trần kích thước trang

**Decision**: `pageSize: z.coerce.number().int().positive().max(100)` trong schema input; vượt trần
trả 422 qua `CustomZodValidationPipe`.

**Rationale**: FR-022. `getPagination` (`src/shared/utils/pagination.ts`) chỉ ép "số nguyên dương,
nếu không thì lấy mặc định" — nó **không** chặn trần, nên `pageSize=1000000` của Launcher đi lọt
xuống `take`. Trần 100 lấy theo `marketplace-product` để hai chỗ nhất quán.

## R8 — Ghi log mọi thao tác ghi

**Decision**: `activate` và `deactivate` log trong `transactionService.afterCommit(...)`; `create`
và `update` log ngay sau khi repo trả về. Mọi dòng log kèm `studioReleaseId` và `actorId`.

**Rationale**: FR-019. `afterCommit` chỉ dùng được bên trong transaction — `create`/`update` không
chạy trong transaction nên log thẳng; nếu nhét vào `afterCommit` ngoài transaction thì callback
không bao giờ chạy. Khuôn log theo `launcher-release.service.ts:101`.

**Hệ quả lên chữ ký controller — khác Launcher**: Launcher chỉ `activate` nhận
`@ActiveUser('userId')`; `create` và `update` không biết ai gọi. Để log được người thực hiện theo
FR-019, **cả bốn** method ghi của Studio (`create`, `update`, `activate`, `deactivate`) phải nhận
`@ActiveUser('userId')` và chuyển xuống service. Sao chép nguyên chữ ký của Launcher sẽ làm rơi
mất actor ở `create`/`update`.

**Alternatives considered**: lưu lịch sử kiểm toán vào DB như `Entitlement.auditHistory` — chủ repo
đã chọn phương án log văn bản, ghi trong Clarifications.

## R9 — `current` giữ nguyên hình dạng của Launcher

**Decision**: output của `current` gồm `id`, `version`, `staticId`, `releaseNotes`, `publishedAt`.
Không kèm đường tải, không cache.

**Rationale**: chủ repo chốt tải tệp phải đăng nhập (spec Clarifications, FR-020), nên module này
không gọi `StaticService` và không mở route công khai nào ngoài `current`. Repo chỉ có đúng một
route tệp công khai là `GET /statics/images/:staticId` — đã quét toàn bộ `@IsPublic()` để xác nhận.

## R10 — Hình thức test

**Decision**: unit test co-located `src/routes/studio-release/test/studio-release.service.spec.ts`
(mock repo + `StaticRepository`), chạy bằng `npm test`. Thêm một e2e
`test/studio-release.e2e-spec.ts` chạy bằng `npm run test:e2e`, bootstrap `AppModule` trên DB local
đã migrate + seed, lấy token admin qua `POST /auth/login`, đi hết chuỗi tạo → kích hoạt → `current`
→ gỡ → `current` 404.

**Rationale**: chủ repo chốt "unit + e2e luồng chính". `npm test` dùng `vitest.config.ts` với
`include: ['**/*.spec.ts']`, **không** khớp `*.e2e-spec.ts` (dấu gạch nối), nên e2e không chạy
trong cổng chất lượng của CI và không làm chậm pipeline — Constitution IV không đổi.

**Hạn chế đã biết**: repo chưa có harness e2e thật, `test/app.e2e-spec.ts` mới là bộ khung mặc định
của Nest. File e2e này tự dựng phần nó cần và phụ thuộc DB local đang chạy — không chạy được trên
máy chưa `compose-up`. Phần kiểm chứng thủ công đầy đủ vẫn nằm ở [quickstart.md](./quickstart.md).

## R11 — `publishedAt` bất biến sau lần đầu

**Decision**: chỉ set khi `publishedAt IS NULL`; `deactivate` không xoá, kích hoạt lại không ghi
đè.

**Rationale**: FR-008 định nghĩa đó là "lần đầu tiên bản được công bố". Launcher đã làm đúng vậy
(`activate` truyền `publishedAt: release.publishedAt ?? now`), chỉ cần giữ nguyên.

## R12 — Permission và cache

**Decision**: không viết seed riêng. Sau khi thêm controller, chạy `npm run seed:permissions`.

**Rationale**: `src/seed/create-permissions.ts` quét AST toàn bộ `*.controller.ts`, tạo permission
cho mọi route rồi gán **tất cả** cho role Admin (`syncAdminPermissions`), và tự xoá cache
role-permission. Constitution II yêu cầu bước này nằm cùng PR — ở đây là một dòng trong quickstart,
không phải file seed mới.

**Chi tiết dễ hiểu nhầm**: seed **không** bỏ qua route có `@IsPublic()` — nó tạo permission cho cả
`GET /studio-releases/current`. Hàng đó vô hại vì guard thoát sớm ở route công khai, và Launcher
hiện cũng đang như vậy.

## R13 — Đóng bất biến ở tầng DB bằng partial unique index

**Decision**: thêm `CREATE UNIQUE INDEX "StudioRelease_isActive_idx" ON "StudioRelease"("isActive")
WHERE ("isActive" AND "deletedAt" IS NULL)`, khai báo trong Prisma bằng
`@unique(map: ..., where: raw(...))`.

**Rationale**: trước đó bất biến "nhiều nhất một bản hiệu lực" chỉ do khoá Redis giữ. Nếu Redis
restart hoặc bị flush đúng lúc một transaction `activate` đang mở, khoá biến mất, Admin thứ hai
lấy được khoá và `deactivateCurrent` không nhìn thấy hàng chưa commit của người thứ nhất (READ
COMMITTED) — hai bản cùng `isActive`. Index này làm DB từ chối trường hợp đó.

**Đảo một quyết định của plan**: data-model ban đầu ghi "không thêm index nào khác" theo
Constitution VI. Lý do đảo: đây không phải index cho hiệu năng giả định mà là **ràng buộc đúng
đắn**, và repo đã dùng đúng khuôn này ở 5 chỗ (`Profile`, `Permission`, `RolePermission`,
`RefreshToken`, `VerificationCode`) nhờ `previewFeatures = ["partialIndexes"]`.

**Alternatives considered**: chỉ thêm `orderBy` cho `getCurrent` để kết quả xác định khi bất biến
vỡ — chữa triệu chứng, không chữa nguyên nhân; giữ nguyên khoá Redis — để ngỏ đúng cái SC-003 hứa
"100% trường hợp".

**Đã kiểm**: chèn tay hai hàng `isActive = true` → DB trả
`duplicate key value violates unique constraint "StudioRelease_isActive_idx"`; hai hàng
`isActive = false` thì vẫn chèn được; toàn bộ 61 kiểm tra quickstart và e2e vẫn xanh, tức luồng
`deactivateCurrent → activate` trong cùng transaction không chạm constraint.
