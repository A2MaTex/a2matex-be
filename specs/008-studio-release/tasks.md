---

description: "Task list for 008-studio-release"
---

# Tasks: Studio Release — quản lý bản phát hành ứng dụng Studio

**Input**: Design documents from `/specs/008-studio-release/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/studio-release-api.md](./contracts/studio-release-api.md),
[quickstart.md](./quickstart.md)

**Tests**: CÓ. Chủ repo đã chốt unit test cho service + một e2e luồng chính (research R10).

**Organization**: nhóm theo user story của spec để mỗi story hoàn thành và kiểm chứng độc lập được.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1 / US2 / US3 theo spec
- Mọi task ghi đường dẫn file chính xác

## Path Conventions

Single project NestJS: `src/routes/studio-release/`, `src/entities/`, `prisma/`, `test/`.
Đường dẫn dưới đây theo mục Project Structure của [plan.md](./plan.md).

**Lưu ý về `[P]` trong feature này**: `studio-release.model.ts`, `.dto.ts`, `.repo.ts`,
`.service.ts`, `.controller.ts` đều là **file dùng chung giữa ba story**. Vì vậy task của các story
khác nhau chạm cùng một file **không** được đánh `[P]`; ba story làm tuần tự theo thứ tự ưu tiên là
cách an toàn.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dựng khung module và môi trường chạy thử

- [X] T001 Tạo thư mục `src/routes/studio-release/` và file `src/routes/studio-release/studio-release.module.ts` khai báo `@Module({ controllers: [], providers: [] })` rỗng
- [X] T002 Đăng ký `StudioReleaseModule` vào mảng `imports` của `src/app.module.ts`, đặt cạnh `LauncherReleaseModule`
- [X] T003 [P] Dựng môi trường local theo [quickstart.md](./quickstart.md) §1: `npm install`, `npm run compose-up`, `npm run prisma:migrate:deploy`, `npm run seed:roles` — chưa chạy `seed:permissions` vì chưa có route

**Checkpoint**: app khởi động được với module rỗng

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: dữ liệu, entity, lỗi và khung 3 lớp mà cả ba story đều cần

**⚠️ CRITICAL**: không story nào bắt đầu được trước khi phase này xong

- [X] T004 Thêm `model StudioRelease` vào `prisma/schema.prisma` theo [data-model.md](./data-model.md): `id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`, `version String @unique @db.VarChar(100)`, `staticId String @db.Uuid`, `releaseNotes String?`, `isActive Boolean @default(false)`, `publishedAt DateTime? @db.Timestamptz(6)`, `createdAt DateTime @default(now()) @db.Timestamptz(6)`, `updatedAt DateTime? @db.Timestamptz(6)`, `deletedAt DateTime? @db.Timestamptz(6)`, quan hệ `static Static @relation(fields: [staticId], references: [id], onDelete: NoAction, onUpdate: NoAction)`
- [X] T005 Thêm dòng `studioReleases StudioRelease[]` vào `model Static` trong `prisma/schema.prisma`
- [X] T006 Tạo migration bằng `npm run prisma:migrate:create`, đặt tên `add_studio_release`, viết nội dung `prisma/migrations/<ts>_add_studio_release/migration.sql` đúng khối SQL trong [data-model.md](./data-model.md) — gồm `CREATE TABLE "StudioRelease"` và `CREATE UNIQUE INDEX "StudioRelease_version_key" ON "StudioRelease"("version")`
- [X] T007 Chạy `npm run prisma:generate` rồi `npm run prisma:migrate:deploy`; xác nhận `npm run build` không còn lỗi TS2694
- [X] T008 [P] Tạo `src/entities/studio-release.model.ts`: schema Zod `StudioRelease` mở rộng `Base` với `version` (string trim, min 1, max 100), `staticId` (uuid), `releaseNotes` (string trim min 1, nullable), `isActive` (boolean), `publishedAt` (`zDate()`, nullable) — gương của `src/entities/launcher-release.model.ts`
- [X] T009 [P] Tạo `src/routes/studio-release/studio-release.error.ts` với 7 exception theo bảng mã lỗi của [contracts/studio-release-api.md](./contracts/studio-release-api.md): `StudioReleaseNotFoundException` (404 `Error.StudioReleaseNotFound`), `ActiveStudioReleaseNotFoundException` (404 `Error.ActiveStudioReleaseNotFound`), `StudioReleaseAlreadyActiveException` (409 `Error.StudioReleaseAlreadyActive`), `StudioReleaseNotActiveException` (409 `Error.StudioReleaseNotActive`), `StudioReleaseVersionTakenException` (409 `Error.StudioReleaseVersionTaken`), `StudioReleaseActiveNotEditableException` (409 `Error.StudioReleaseActiveNotEditable`), `StudioReleaseStaticNotFoundException` (422 `UnprocessableEntityException` với `{ message: 'Error.StaticNotFound', path: 'staticId' }`)
- [X] T010 Tạo `src/routes/studio-release/studio-release.repo.ts`: class `StudioReleaseRepo` inject `PrismaService`, getter private `prisma` trả `this.prismaService.getClient()` — chưa có method
- [X] T011 Tạo `src/routes/studio-release/studio-release.service.ts`: class `StudioReleaseService` với `private readonly logger = new Logger(StudioReleaseService.name)` và inject đủ bốn thứ, **tên thuộc tính là hợp đồng chứ không phải quy ước** (research R3): `studioReleaseRepo`, `staticRepository` (`StaticRepository`), `cacheProvider` (`@Inject(CACHE_PROVIDER)` — `@DistributedLock` đọc `this.cacheProvider`), `transactionService` (`@Transactional` đọc `this.transactionService`)
- [X] T012 Tạo `src/routes/studio-release/studio-release.controller.ts` rỗng với `@ApiTags('Studio Releases')` và `@Controller('studio-releases')`, inject `StudioReleaseService`; cập nhật `studio-release.module.ts` khai báo controller + 2 provider
- [X] T013 Tạo `src/routes/studio-release/studio-release.model.ts` với hai schema dùng chung: `StudioReleaseIdParam` (`{ studioReleaseId: z.uuid() }`, `.strict()`) và hằng `SemanticVersion` = `z.string().max(100).regex(STRICT_SEMANTIC_VERSION_PATTERN, { message: 'Error.StudioReleaseVersionInvalid' })` import từ `src/routes/node-catalog/node-catalog.constant.ts` (research R4 — pattern `/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/`, không nhận `-beta.1`, `+build`, `1.02.0`)
- [X] T014 Tạo `src/routes/studio-release/studio-release.dto.ts` với `StudioReleaseIdParamDTO extends createZodDto(StudioReleaseIdParam)`

**Checkpoint**: schema, migration, entity, lỗi và khung 3 lớp sẵn sàng — bắt đầu được user story

---

## Phase 3: User Story 1 — Studio kiểm tra và tải bản cập nhật (Priority: P1) 🎯 MVP

**Goal**: Studio hỏi "bản hiện hành là gì" mà không cần đăng nhập, nhận đủ thông tin để quyết định
có nhắc cập nhật hay không (FR-012, FR-013).

**Independent Test**: chèn sẵn một hàng `StudioRelease` có `isActive = true` bằng SQL, gọi
`GET /api/v1/studio-releases/current` **không kèm token**, nhận đủ `id`, `version`, `staticId`,
`releaseNotes`, `publishedAt`. Không cần US2 hay US3.

### Tests for User Story 1 ⚠️

> Viết trước, chạy phải đỏ trước khi làm phần implementation bên dưới

- [X] T015 [US1] Tạo `src/routes/studio-release/test/studio-release.service.spec.ts` với bộ ca cho `getCurrent`: repo trả `null` → ném `ActiveStudioReleaseNotFoundException`; repo trả bản ghi → trả nguyên bản ghi đó

### Implementation for User Story 1

- [X] T016 [US1] Thêm `CurrentStudioReleaseOutput` vào `src/routes/studio-release/studio-release.model.ts`: pick `id`, `version`, `staticId`, `releaseNotes`, `publishedAt` từ entity
- [X] T017 [US1] Thêm `CurrentStudioReleaseOutputDTO` vào `src/routes/studio-release/studio-release.dto.ts`
- [X] T018 [US1] Thêm `getCurrent()` vào `src/routes/studio-release/studio-release.repo.ts`: `findFirst` với `where: { isActive: true, deletedAt: null, static: { deletedAt: null } }` (FR-013 — bỏ qua bản có tệp đã xoá), `select` đúng 5 trường của `CurrentStudioReleaseOutput`
- [X] T019 [US1] Thêm `getCurrent()` vào `src/routes/studio-release/studio-release.service.ts`: không có bản → ném `ActiveStudioReleaseNotFoundException`
- [X] T020 [US1] Thêm route `@Get('current')` + `@IsPublic()` + `@ZodResponse({ type: CurrentStudioReleaseOutputDTO })` vào `src/routes/studio-release/studio-release.controller.ts`
- [X] T021 [US1] Kiểm chứng kịch bản **S1** của [quickstart.md](./quickstart.md): gọi không token khi chưa có bản nào → `404 Error.ActiveStudioReleaseNotFound`; chèn một hàng `isActive = true` bằng SQL rồi gọi lại → `200` với đủ 5 trường

**Checkpoint**: US1 chạy độc lập — Studio đã kiểm tra cập nhật được

---

## Phase 4: User Story 2 — Admin đăng và kích hoạt bản phát hành (Priority: P2)

**Goal**: Admin tạo bản phát hành, công bố, quay lui bản cũ, hoặc gỡ hẳn không công bố bản nào
(FR-001…FR-011, FR-021).

**Independent Test**: tạo bản mới → xác nhận `isActive: false` → kích hoạt → `GET current` trả
đúng bản đó → gỡ hiệu lực → `GET current` trả 404.

### Tests for User Story 2 ⚠️

- [X] T022 [US2] Thêm ca cho `create` vào `src/routes/studio-release/test/studio-release.service.spec.ts`: `staticId` không tồn tại → `StudioReleaseStaticNotFoundException`; repo ném `PrismaClientKnownRequestError` code `P2002` → `StudioReleaseVersionTakenException` (mẫu giả lập: `src/routes/workflow-revision/test/workflow-revision.service.spec.ts:211`)
- [X] T023 [US2] Thêm ca cho `activate` vào cùng file: không tìm thấy → `StudioReleaseNotFoundException`; `static.deletedAt` khác null → `StudioReleaseStaticNotFoundException`; đang `isActive` → `StudioReleaseAlreadyActiveException`; đường thành công gọi `deactivateCurrent` **trước** `activate` và truyền `publishedAt: release.publishedAt ?? now` (FR-008 — kích hoạt lại giữ nguyên mốc cũ)
- [X] T024 [US2] Thêm ca cho `deactivate` vào cùng file: không tìm thấy → `StudioReleaseNotFoundException`; không `isActive` → `StudioReleaseNotActiveException`; thành công thì **không** đụng `publishedAt`

### Implementation for User Story 2

- [X] T025 [US2] Thêm vào `src/routes/studio-release/studio-release.model.ts`: `CreateStudioReleaseInput` = `{ version: SemanticVersion, staticId: z.uuid(), releaseNotes }` với `releaseNotes` optional (string trim min 1), `.strict()`; và `CreateStudioReleaseOutput` = pick `id`
- [X] T026 [US2] Thêm `CreateStudioReleaseInputDTO` và `CreateStudioReleaseOutputDTO` vào `src/routes/studio-release/studio-release.dto.ts`
- [X] T027 [US2] Thêm `create(data)` vào `src/routes/studio-release/studio-release.repo.ts`: ghi `version`, `staticId`, `releaseNotes`, ép `isActive: false` (FR-002 — không nhận từ client), `select: { id: true }`
- [X] T028 [US2] Thêm `getActivationContext(id)`, `deactivateCurrent({ excludeId, now })`, `activate({ id, now, publishedAt })`, `deactivateById({ id, now })` vào `src/routes/studio-release/studio-release.repo.ts`; `getActivationContext` lấy `id`, `isActive`, `publishedAt`, `static: { select: { deletedAt: true } }` với `where: { id, deletedAt: null }`; `deactivateCurrent` là `updateMany` với `where: { id: { not: excludeId }, isActive: true, deletedAt: null }`
- [X] T029 [US2] Thêm `create({ data, userId })` vào `src/routes/studio-release/studio-release.service.ts`: gọi `assertStaticExists` (dùng `StaticRepository.findById`, đã lọc `deletedAt: null`) rồi `try/catch` quanh `repo.create`, bắt bằng `isUniqueConstraintPrismaError` từ `src/shared/utils/prisma.ts` → ném `StudioReleaseVersionTakenException`, và **`throw error` ở cuối `catch`** cho mọi lỗi khác (khuôn `role.service.ts:44`; thiếu dòng này là nuốt lỗi) (research R1 — **không** pre-check)
- [X] T030 [US2] Thêm `activate({ id, userId })` vào `src/routes/studio-release/studio-release.service.ts` với `@DistributedLock({ useCase: 'activate_studio_release' })` + `@Transactional()`: kiểm tra tồn tại → tệp chưa xoá → chưa `isActive`, rồi `deactivateCurrent` → `activate` với `publishedAt: release.publishedAt ?? now`. **Không** so sánh số phiên bản (FR-011 cho phép rollback). **Không truyền `resource`**: `buildDistributedLockKey` (`distributed-lock.decorator.ts:88`) lấy chính `useCase` làm khoá khi thiếu `resource`, tức một mutex toàn bảng — đúng thứ FR-006 cần. Thêm `resource: (args) => args.id` sẽ cho hai Admin kích hoạt hai bản khác nhau hai khoá khác nhau và phá vỡ bất biến "nhiều nhất một bản hiệu lực"
- [X] T031 [US2] Thêm `deactivate({ id, userId })` vào `src/routes/studio-release/studio-release.service.ts`, dùng **cùng** `useCase: 'activate_studio_release'` + `@Transactional()`, cũng không `resource` — vì khoá là chính `useCase`, dùng lại đúng chuỗi đó là cách duy nhất để `activate` và `deactivate` loại trừ lẫn nhau; không `isActive` → `StudioReleaseNotActiveException`; giữ nguyên `publishedAt`
- [X] T032 [US2] Thêm log cho ba thao tác: `activate`/`deactivate` log trong `this.transactionService.afterCommit(...)`, `create` log ngay sau khi repo trả về (research R8 — `afterCommit` ngoài transaction sẽ không bao giờ chạy); mỗi dòng kèm `studioReleaseId` và `actorId`
- [X] T033 [US2] Thêm 3 route vào `src/routes/studio-release/studio-release.controller.ts`: `@Post()`, `@Put(':studioReleaseId/activate')`, `@Put(':studioReleaseId/deactivate')`, tất cả `@ApiBearerAuth('access-token')`; **cả ba nhận `@ActiveUser('userId')`** — khác Launcher, nơi chỉ `activate` có (research R8)
- [X] T034 [US2] Kiểm chứng kịch bản **S2, S3, S4, S5, S6, S8** của [quickstart.md](./quickstart.md), chú ý S6 (rollback không làm đổi `publishedAt`) và S3 (bảng 7 dòng validate)

**Checkpoint**: US1 + US2 chạy độc lập — vòng đời phát hành đã đủ dùng

---

## Phase 5: User Story 3 — Admin tra cứu và sửa bản phát hành (Priority: P3)

**Goal**: Admin xem lịch sử phát hành và sửa thông tin nhập sai, với bản đang hiệu lực bị khoá
(FR-014…FR-016, FR-022, FR-023).

**Independent Test**: tạo vài bản, xem danh sách có phân trang và sắp mới nhất trước kèm tên tệp +
dung lượng; mở chi tiết; sửa ghi chú thành công; sửa `version` của bản đang hiệu lực bị từ chối.

### Tests for User Story 3 ⚠️

- [X] T035 [US3] Thêm ca cho `update` vào `src/routes/studio-release/test/studio-release.service.spec.ts`: không tìm thấy → `StudioReleaseNotFoundException`; bản `isActive` + payload có `version` hoặc `staticId` → `StudioReleaseActiveNotEditableException` và **không** gọi `repo.update`; bản `isActive` + chỉ `releaseNotes` → đi qua; `staticId` mới không tồn tại → `StudioReleaseStaticNotFoundException`; repo ném `P2002` → `StudioReleaseVersionTakenException`
- [X] T036 [US3] Thêm ca cho `getDetail` vào cùng file: không tìm thấy → `StudioReleaseNotFoundException`

### Implementation for User Story 3

- [X] T037 [US3] Thêm vào `src/routes/studio-release/studio-release.model.ts`: `GetStudioReleaseListInput` với `page` (coerce int positive, default `DEFAULT_PAGE`) và `pageSize` (coerce int positive, **`.max(100)`** — FR-022, research R7), `.strict()`; `StudioReleaseListItemOutput` (pick `id`, `version`, `staticId`, `isActive`, `publishedAt`, `createdAt` + `originalFileName`, `size`); `GetStudioReleaseListOutput` (`items`, `totalItems`, `page`, `pageSize`, `totalPages`); `GetStudioReleaseDetailOutput` (thêm `releaseNotes`, `updatedAt`, object `static` gồm `id`, `originalFileName`, `contentType`, `size`); `UpdateStudioReleaseInput` = pick `version`/`staticId`/`releaseNotes` `.partial().strict().refine(...)` bắt buộc ≥ 1 trường
- [X] T038 [US3] Thêm 4 DTO tương ứng vào `src/routes/studio-release/studio-release.dto.ts`
- [X] T039 [US3] Thêm `getList(query)`, `getById(id)`, `update({ id, data })` vào `src/routes/studio-release/studio-release.repo.ts`: `getList` dùng `getPagination`, `where: { deletedAt: null }`, `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`, join `static` lấy `originalFileName` + `size` rồi `Number(size)` vì cột là `BigInt`; `getList`/`getById` **không** lọc `static.deletedAt` (FR-023 — Admin phải thấy bản có tệp đã xoá); `update` set `updatedAt: new Date()`
- [X] T040 [US3] Thêm `getList`, `getDetail` vào `src/routes/studio-release/studio-release.service.ts`
- [X] T041 [US3] Thêm `update({ id, data, userId })` vào `src/routes/studio-release/studio-release.service.ts`: đọc bản ghi trước (lấy cả `isActive`), nếu `isActive` và payload có `version` hoặc `staticId` → ném `StudioReleaseActiveNotEditableException` **trước mọi lệnh ghi** (FR-016, research R6); nếu có `staticId` mới thì `assertStaticExists`; bọc `try/catch` **chỉ quanh lệnh `repo.update`** như T029, kèm `throw error` cho lỗi không phải `P2002`; log sau khi ghi thành công
- [X] T042 [US3] Thêm 3 route vào `src/routes/studio-release/studio-release.controller.ts`: `@Get()`, `@Get(':studioReleaseId')`, `@Put(':studioReleaseId')` với `@ApiBearerAuth('access-token')`; route `@Put` nhận `@ActiveUser('userId')`. Đặt `@Get()` và `@Get(':studioReleaseId')` **sau** `@Get('current')` để route literal không bị param nuốt
- [X] T043 [US3] Kiểm chứng kịch bản **S7, S9, S10** của [quickstart.md](./quickstart.md)

**Checkpoint**: cả ba story chạy độc lập

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T044 Chạy `npm run seed:permissions`, xác nhận 7 permission mới xuất hiện (kể cả `GET /api/v1/studio-releases/current` — seed không bỏ qua `@IsPublic`, hàng đó vô hại) và cache role-permission đã được xoá (Constitution II, research R12)
- [X] T045 Viết `test/studio-release.e2e-spec.ts` chạy bằng `npm run test:e2e`: bootstrap `AppModule`, lấy token admin qua `POST /api/v1/auth/login` (`{ account, password }` → `data.accessToken`, một yếu tố), đi hết chuỗi tạo → kích hoạt → `current` → gỡ → `current` 404 (research R10). **Phải tự dọn**: `version` là unique toàn cục và không có API xoá, nên lần chạy thứ hai sẽ đỏ vì `P2002` nếu không sinh version ngẫu nhiên mỗi lần chạy hoặc xoá hàng đã tạo trong `afterAll`
- [X] T046 [P] Kiểm chứng kịch bản **S11, S12, S13, S14** của [quickstart.md](./quickstart.md): phân quyền, tải tệp vẫn cần đăng nhập, log đủ bốn thao tác ghi, bản xoá mềm biến mất
- [X] T047 Chạy cổng chất lượng trước khi mở PR: `npm run lint`, `npm test`, `npm run prisma:generate && npm run build` (Constitution IV)
- [X] T049 Sau code review: thêm partial unique index `StudioRelease_isActive_idx` vào `prisma/schema.prisma` và `prisma/migrations/20261123120000_add_studio_release/migration.sql`, đảo quyết định "không thêm index" của data-model (R13); migration chưa commit nên sửa tại chỗ và áp lại trên DB local đang trống
- [X] T048 Rà lại [plan.md](./plan.md) mục **Truy vết yêu cầu**: 23/23 FR đều có code tương ứng; cập nhật bảng nếu triển khai lệch khỏi thiết kế

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: không phụ thuộc gì
- **Foundational (Phase 2)**: cần Phase 1 — **chặn toàn bộ** user story
- **US1 (Phase 3)**: cần Phase 2
- **US2 (Phase 4)**: cần Phase 2. Không cần US1
- **US3 (Phase 5)**: cần Phase 2. Không cần US1/US2
- **Polish (Phase 6)**: cần các story muốn giao đã xong; T044 cần ít nhất một route tồn tại

### Trong từng task

- T004 → T005 → T006 → T007 (schema trước migration trước generate)
- T010, T011, T012 cần T008 + T009
- Mọi task `.dto.ts` cần task `.model.ts` tương ứng đã export schema
- Mọi task service cần task repo tương ứng
- Mọi task controller cần task service tương ứng

### Parallel Opportunities

Ít hơn bình thường vì ba story dùng chung 5 file:

- T003 song song với T001–T002
- T008 và T009 song song (hai file mới, không liên quan nhau)
- T046 song song với T047
- Các story **không** chạy song song được: cùng sửa `studio-release.model.ts`, `.dto.ts`,
  `.repo.ts`, `.service.ts`, `.controller.ts`. Nếu muốn chia người, chia theo phase chứ không theo
  story.

---

## Parallel Example: Phase 2

```bash
# Hai file mới, không đụng nhau:
Task: "T008 Tạo entity src/entities/studio-release.model.ts"
Task: "T009 Tạo src/routes/studio-release/studio-release.error.ts"
```

---

## Implementation Strategy

### MVP (chỉ US1)

1. Phase 1 → Phase 2 → Phase 3
2. **DỪNG và kiểm chứng**: kịch bản S1, với dữ liệu chèn bằng SQL
3. Lúc này Studio đã kiểm tra cập nhật được, nhưng Admin chưa có đường tạo bản qua API

### Giao tăng dần

1. Setup + Foundational → nền sẵn sàng
2. US1 → kiểm chứng S1 → dùng được
3. US2 → kiểm chứng S2–S6, S8 → vòng đời phát hành đầy đủ, **đây mới là mốc dùng thật được**
4. US3 → kiểm chứng S7, S9, S10 → đủ công cụ vận hành
5. Phase 6 → seed quyền, e2e, cổng chất lượng

> Thực tế US2 mới là ranh giới "dùng được": thiếu nó thì mọi bản phát hành phải chèn bằng SQL. US1
> được xếp P1 vì nó là lý do tính năng tồn tại, không phải vì nó đủ dùng một mình.

---

## Notes

- `[P]` = khác file, không phụ thuộc nhau
- Mỗi story kiểm chứng độc lập được bằng kịch bản quickstart tương ứng
- Test viết trước, chạy đỏ, rồi mới implement
- Commit theo từng task hoặc nhóm task logic
- Không đụng `src/routes/launcher-release/` — chủ repo đã chốt không backport (spec Out of Scope)
