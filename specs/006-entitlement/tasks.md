---

description: "Task list for 006-entitlement"
---

# Tasks: Entitlement — quyền sử dụng Product của customer

**Input**: Design documents from `/specs/006-entitlement/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/entitlement-api.md](./contracts/entitlement-api.md),
[quickstart.md](./quickstart.md)

**Tests**: spec không yêu cầu TDD, nhưng plan/research R10 chốt unit test Vitest co-located ở
`src/routes/entitlement/test/` cho service và controller — nên mỗi story có task test, viết sau phần
triển khai của story đó. Ràng buộc DB và đồng thời kiểm chứng thủ công theo quickstart (Phase 8).

**Organization**: Tasks nhóm theo user story của spec. `planning-notes.md` chỉ là đầu vào lịch sử —
khi mâu thuẫn, theo research/data-model/contracts.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1–US4 theo spec.md

## Quy ước chung cho mọi task

- Import TypeScript dùng đuôi `.ts` (ESM, `tsx`), inject bằng `@Inject(Class)` như các module hiện có.
- Repo luôn lấy client qua `this.prismaService.getClient()` để tự tham gia transaction của caller
  (research R2); method ghi của service bọc `@Transactional()` và class inject `TransactionService`
  với tên field `transactionService`.
- Mọi so sánh thời gian dùng `now()` của DB; truy vấn khoá trả `transactionNow` dạng epoch ms
  `(EXTRACT(EPOCH FROM now()) * 1000)::bigint AS "transactionNowMs"` rồi `new Date(Number(...))`,
  theo `src/routes/product-offer/product-offer.repo.ts` (research R4).
- Exception khai báo dạng hằng trong `entitlement.error.ts`, theo `product-offer.error.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: hằng số và entity model dùng chung cho cả module.

- [X] T001 [P] Tạo `src/shared/constants/entitlement.constant.ts` export: `EntitlementStatus = { ACTIVE, REVOKED }` (chỉ 2 giá trị — research R3); `EntitlementGrantSource = { ORDER, ADMIN_GRANT }`; `EntitlementEffectiveStatus = { ACTIVE, EXPIRED, REVOKED }`; `EntitlementAuditAction = { GRANT, REVOKE }`; `EntitlementUsageDenyReason = { NOT_FOUND, REVOKED, EXPIRED, PRODUCT_UNAVAILABLE, PRODUCT_SUSPENDED }`; `ENTITLEMENT_REASON_MAX_LENGTH = 2_000`; `ENTITLEMENT_GRANT_SNAPSHOT = { schemaVersion: '1.0', releaseAccess: 'CURRENT_AND_SUPPORTED', allowUpdates: true } as const`; kèm các type `...Value` theo mẫu `src/shared/constants/product-offer.constant.ts`
- [X] T002 [P] Tạo `src/entities/entitlement.model.ts`: Zod mirror của model `Entitlement` theo bảng cột trong data-model.md (dùng `z.uuid()`, `z.date()`, `.nullable()` đúng cột nullable; `status` là enum 2 giá trị `ACTIVE | REVOKED`; `grantSnapshot` object; `auditHistory` array), theo mẫu `src/entities/product-offer.model.ts` (phụ thuộc T001)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema DB, migration, khung module và phần repo/model dùng chung cho mọi story.

**⚠️ CRITICAL**: không story nào bắt đầu trước khi phase này xong.

- [X] T003 Sửa `prisma/schema.prisma`: thêm `enum EntitlementStatus { ACTIVE REVOKED }`, `enum EntitlementGrantSource { ORDER ADMIN_GRANT }` và `model Entitlement` với đúng các cột trong data-model.md (`@db.Uuid`, `@db.Timestamptz(6)`, `grantSnapshot Json`, `auditHistory Json @default("[]")`, `status @default(ACTIVE)`, `createdAt @default(now())`); `@@unique([customerId, productId])`, `@@index([productId])`; relation có tên tới `User` cho `customerId` / `grantedById` / `revokedById` (thêm 3 back-relation trên `model User`), tới `Product` và `ProductOffer` (`latestProductOfferId`, thêm back-relation); `latestOrderItemId String? @db.Uuid` **không relation** (research R8); thêm comment `/// This table contains check constraints...` như các model khác có CHECK
- [X] T004 Tạo migration bằng `npm run prisma:migrate:create -- --name add_entitlement`, rồi viết tay `prisma/migrations/<timestamp>_add_entitlement/migration.sql` theo data-model.md: header comment mô tả quyết định (theo mẫu `20261117173000_add_product_offer/migration.sql`); 2 `CREATE TYPE`; `CREATE TABLE "Entitlement"` với FK `ON DELETE NO ACTION ON UPDATE NO ACTION`; đủ 6 CHECK: `Entitlement_customerId_productId_key` (UNIQUE), `Entitlement_period_check` (`"expiresAt" IS NULL OR "expiresAt" > "startsAt"`), `Entitlement_revoke_fields_check` (hai chiều: REVOKED ⇔ cả `revokedAt`, `revokedById`, `revokedReason` NOT NULL; không REVOKED ⇒ cả ba NULL), `Entitlement_granted_by_check` (`("grantSource" = 'ADMIN_GRANT') = ("grantedById" IS NOT NULL)`), `Entitlement_grantSnapshot_object_check`, `Entitlement_auditHistory_array_check`; `CREATE INDEX "Entitlement_productId_idx"`. Apply trên DB rỗng bằng `npm run prisma:migrate:deploy` (Constitution III) (phụ thuộc T003)
- [X] T005 Chạy `npm run prisma:generate` và xác nhận `src/generated/prisma` có model `Entitlement` (phụ thuộc T004)
- [X] T006 [P] Tạo `src/routes/entitlement/entitlement.error.ts` với đúng 6 exception của contract: `EntitlementProductNotActiveException = new ConflictException('Error.EntitlementProductNotActive')`, `EntitlementCustomerNotFoundException = new NotFoundException('Error.EntitlementCustomerNotFound')`, `EntitlementInvalidExpiresAtException = new UnprocessableEntityException('Error.EntitlementInvalidExpiresAt')`, `EntitlementNotFoundException = new NotFoundException('Error.EntitlementNotFound')`, `EntitlementAlreadyRevokedException = new ConflictException('Error.EntitlementAlreadyRevoked')`, `EntitlementOperationTimeoutException = new ServiceUnavailableException('Error.EntitlementOperationTimeout')`; dùng lại `ProductNotFoundException` từ `src/routes/product/product.error.ts` cho Product không tồn tại (không tạo mới)
- [X] T007 [P] Tạo `src/routes/entitlement/entitlement.model.ts` phần dùng chung: `EntitlementStateSnapshotSchema` (`status`, `grantSource`, `startsAt`, `expiresAt` nullable, và optional `revokedAt`, `revokedById`, `revokedReason`); `EntitlementAuditEntrySchema` (`action: 'GRANT' | 'REVOKE'`, `reason`, `actedAt`, `actedById`, `before: snapshot | null`, `after: snapshot`); `AdminEntitlementOutput` đúng shape `AdminEntitlement` trong contracts/entitlement-api.md (thời gian là ISO string qua `z.iso.datetime()` hoặc pattern date đang dùng trong `src/routes/user/user.model.ts`; `status` = effective, thêm `storedStatus`); `EntitlementIdParam` (`entitlementId: z.uuid()`) (phụ thuộc T001)
- [X] T008 Tạo `src/routes/entitlement/entitlement.repo.ts` khung `@Injectable() EntitlementRepo` inject `PrismaService` với getter `prisma` → `getClient()`; thêm: (a) hằng `Prisma.sql` `EFFECTIVE_STATUS_SQL` = `CASE WHEN e.status = 'REVOKED' THEN 'REVOKED' WHEN e."expiresAt" IS NOT NULL AND e."expiresAt" <= now() THEN 'EXPIRED' ELSE 'ACTIVE' END` (research R3); (b) `findAdminById(id)` trả row đầy đủ kèm `effectiveStatus` qua `$queryRaw` (dùng sau mỗi grant/revoke để build response); (c) hàm private chuẩn hoá row raw → kiểu TS (BigInt/Date/JSON) theo cách `product-offer.repo.ts` chuẩn hoá (phụ thuộc T005, T007)
- [X] T009 Tạo `src/routes/entitlement/entitlement.service.ts` khung `EntitlementService` inject `EntitlementRepo`, `TransactionService` (field `transactionService`), `Logger`; thêm helper private `toAdminOutput(row)` map row → `AdminEntitlementOutput` (Date → ISO string, parse `auditHistory` bằng `EntitlementAuditEntrySchema.array()`) (phụ thuộc T008)
- [X] T010 Tạo `src/routes/entitlement/entitlement.module.ts` (`providers: [EntitlementService, EntitlementRepo]`, `exports: [EntitlementService]`, controllers điền dần ở các story; comment: không import OrderModule — Order import module này) và đăng ký `EntitlementModule` trong `imports` của `src/app.module.ts` (phụ thuộc T009)

**Checkpoint**: migration đã apply, app khởi động được với module rỗng.

---

## Phase 3: User Story 1 - Admin cấp quyền thủ công cho customer (Priority: P1) 🎯 MVP

**Goal**: Admin cấp/ghi đè quyền cho customer với Product đang bán, có lịch sử kiểm toán; các module
khác kiểm tra được quyền qua `checkUsage`.

**Independent Test**: quickstart S1–S4: grant 30 ngày cho customer mới → `200`, `ACTIVE`,
`ADMIN_GRANT`, 1 audit entry `before=null`; `checkUsage` trả `usable: true`.

### Implementation for User Story 1

- [X] T011 [US1] Thêm vào `src/routes/entitlement/entitlement.model.ts`: `GrantEntitlementInput` strict: `customerId: z.uuid()`, `productId: z.uuid()`, `expiresAt: z.iso.datetime().nullable()` — **bắt buộc có mặt; null = vĩnh viễn** (không `.optional()`), `reason: z.string().trim().min(1).max(ENTITLEMENT_REASON_MAX_LENGTH)` (trim, 1..2000); type `UsageCheck` theo contract §5
- [X] T012 [P] [US1] Tạo `src/routes/entitlement/entitlement.dto.ts` với `GrantEntitlementInputDTO`, `AdminEntitlementOutputDTO`, `EntitlementIdParamDTO` bằng `createZodDto` (phụ thuộc T011)
- [X] T013 [US1] Thêm vào `src/routes/entitlement/entitlement.repo.ts` các method khoá theo thứ tự research R5: `lockActiveCandidateProduct(productId)` → `SELECT id, status, transactionNowMs FROM "Product" WHERE id = $1 AND "deletedAt" IS NULL FOR UPDATE` (trả `null` nếu không có); `lockCustomerProfile(customerId)` → `SELECT p.id FROM "Profile" p JOIN "User" u ON u.id = p."userId" WHERE p."userId" = $1 AND p."deletedAt" IS NULL AND u."deletedAt" IS NULL FOR UPDATE OF p`; `findByCustomerProductForUpdate(customerId, productId)` → row hoặc `null`
- [X] T014 [US1] Thêm vào `src/routes/entitlement/entitlement.repo.ts`: `insertFromAdminGrant({ customerId, productId, startsAt, expiresAt, grantedById, auditEntry })` — INSERT `status='ACTIVE'`, `grantSource='ADMIN_GRANT'`, `grantSnapshot = ENTITLEMENT_GRANT_SNAPSHOT`, `auditHistory = jsonb_build_array(auditEntry)`, `RETURNING id`; và `overwriteFromAdminGrant({ id, startsAt, expiresAt, grantedById, auditEntry })` — một câu `UPDATE` set `status='ACTIVE'`, `grantSource='ADMIN_GRANT'`, `grantedById`, `startsAt`, `expiresAt`, `grantSnapshot`, `revokedAt = NULL`, `revokedById = NULL`, `revokedReason = NULL`, `"auditHistory" = COALESCE("auditHistory",'[]'::jsonb) || jsonb_build_array(${auditEntry}::jsonb)`, `"updatedAt" = now()`; **không** đụng `latestOrderItemId`, `latestProductOfferId`, `oneTimePurchasedAt` (FR-021). Theo mẫu append của `src/routes/user/user.repo.ts` `transitionStatus` (phụ thuộc T013)
- [X] T015 [US1] Thêm `grant({ data, adminUserId })` vào `src/routes/entitlement/entitlement.service.ts`: method public bọc try/catch, gọi method private `@Transactional() grantInTransaction`; thứ tự trong transaction: `lockActiveCandidateProduct` → null ⇒ `ProductNotFoundException`, `status !== 'ACTIVE'` ⇒ `EntitlementProductNotActiveException`; `lockCustomerProfile` → null ⇒ `EntitlementCustomerNotFoundException`; `expiresAt !== null && expiresAt <= transactionNow` ⇒ `EntitlementInvalidExpiresAtException`; `findByCustomerProductForUpdate` → build audit entry `{ action: 'GRANT', reason, actedAt: transactionNow, actedById: adminUserId, before: snapshot | null, after: snapshot }` (before chứa revoke fields nếu đang REVOKED) → insert hoặc overwrite với `startsAt = transactionNow`; trả `toAdminOutput(await repo.findAdminById(id))`. Catch `isTransactionTimeoutPrismaError` ⇒ `EntitlementOperationTimeoutException`; `isUniqueConstraintPrismaError` ⇒ log error rồi ném lại (lỗi nội bộ — research R5). Log `Entitlement grant committed entitlementId=… customerId=… productId=… adminUserId=…`; không log `reason`
- [X] T016 [US1] Thêm vào `src/routes/entitlement/entitlement.repo.ts`: `findUsage(customerId, productId)` — một `$queryRaw` LEFT JOIN `Entitlement` với `Product` trả `entitlementId`, `status`, `expired` (`e."expiresAt" IS NOT NULL AND e."expiresAt" <= now()`), `productDeleted`, `productStatus`
- [X] T017 [US1] Thêm `checkUsage({ customerId, productId }): Promise<UsageCheck>` vào `src/routes/entitlement/entitlement.service.ts` theo FR-010 và thứ tự lý do: không có row ⇒ `NOT_FOUND`; Product đã xoá ⇒ `PRODUCT_UNAVAILABLE`; `REVOKED` ⇒ `REVOKED` (bất kể `expiresAt`); hết hạn ⇒ `EXPIRED`; Product `SUSPENDED` ⇒ `PRODUCT_SUSPENDED`; còn lại `{ usable: true, entitlementId }` (Product `ARCHIVED` vẫn usable). Không ném exception, không bọc `@Transactional` (phụ thuộc T016)
- [X] T018 [US1] Tạo `src/routes/entitlement/admin-entitlement.controller.ts`: `@ApiTags('Entitlement Management')`, `@ApiBearerAuth('access-token')`, `@Controller('admin/entitlements')`; route `@Post('grant') @HttpCode(200) @ZodResponse({ type: AdminEntitlementOutputDTO })` nhận `@Body() GrantEntitlementInputDTO`, `@ActiveUser('userId') adminUserId`, gọi `entitlementService.grant`. Theo mẫu `src/routes/user/user.controller.ts`; đăng ký controller trong `entitlement.module.ts`
- [X] T019 [P] [US1] Viết `src/routes/entitlement/test/entitlement.service.spec.ts` (mock `EntitlementRepo`, `TransactionService.runInTransaction` gọi thẳng callback): grant tạo mới (audit `before=null`); grant ghi đè row còn hạn giữ nguyên `latestOrderItemId`/`oneTimePurchasedAt` (kiểm tra tham số gọi repo); grant row REVOKED → overwrite + audit `before` có revoke fields; Product null → `ProductNotFoundException`; Product `DRAFT`/`ARCHIVED`/`SUSPENDED` → `EntitlementProductNotActiveException`; Profile null → `EntitlementCustomerNotFoundException`; `expiresAt <= transactionNow` → `EntitlementInvalidExpiresAtException`; `expiresAt = null` hợp lệ; timeout → `EntitlementOperationTimeoutException`; `checkUsage` đủ 6 nhánh (5 lý do + usable, gồm `ARCHIVED` usable và `REVOKED` với `expiresAt` null)

**Checkpoint**: S1–S4 của quickstart chạy được sau khi seed permission (T035).

---

## Phase 4: User Story 2 - Customer xem danh sách Product của mình (Priority: P1)

**Goal**: `GET /entitlements/me` trả quyền của chính caller với trạng thái hiển thị, không lộ thông
tin quản trị.

**Independent Test**: quickstart S5, S7 (phần My Products): ba quyền còn hạn / quá hạn / bị thu hồi
hiển thị đúng `ACTIVE` / `EXPIRED` / `REVOKED`; customer khác không thấy.

### Implementation for User Story 2

- [X] T020 [US2] Thêm vào `src/routes/entitlement/entitlement.model.ts`: `GetMyEntitlementsInput = PaginationQuerySchema` (từ `src/shared/models/request.model.ts`); `MyEntitlementItemOutput` gồm **chỉ** `id`, `status` (effective), `grantSource`, `startsAt`, `expiresAt` nullable, `product { id, name nullable, slug nullable, status: DRAFT|ACTIVE|SUSPENDED|ARCHIVED }`, `publisher { username, displayName }`; `GetMyEntitlementsOutput` = `{ items, totalItems, page, pageSize, totalPages }` theo `src/routes/user/user.model.ts`; thêm DTO tương ứng vào `src/routes/entitlement/entitlement.dto.ts`. KHÔNG có `revokedAt`, `revokedById`, `revokedReason`, `grantedById`, `auditHistory`, `latestOrderItemId`, `latestProductOfferId`, `oneTimePurchasedAt`, `grantSnapshot` (FR-050)
- [X] T021 [US2] Thêm `listMine({ customerId, skip, take })` vào `src/routes/entitlement/entitlement.repo.ts`: `$queryRaw` select `EFFECTIVE_STATUS_SQL`, join `Product` → `PublisherAccount` → `User` (`username`) → `Profile` (`fullName` AS `displayName`, như `marketplace-product.repo.ts`), `WHERE e."customerId" = $1`, `ORDER BY e."startsAt" DESC, e.id ASC`, `LIMIT/OFFSET`; kèm `countMine(customerId)`
- [X] T022 [US2] Thêm `listMine({ userId, query })` vào `src/routes/entitlement/entitlement.service.ts` dùng `getPagination(query)` từ `src/shared/utils/pagination.ts`, trả `totalPages = Math.ceil(totalItems / pageSize)` (phụ thuộc T021)
- [X] T023 [US2] Tạo `src/routes/entitlement/entitlement.controller.ts`: `@ApiTags('Entitlements')`, `@ApiBearerAuth('access-token')`, `@Controller('entitlements')`, route `@Get('me') @ZodResponse({ type: GetMyEntitlementsOutputDTO })` nhận `@Query() GetMyEntitlementsInputDTO` và `@ActiveUser('userId')`; không dùng `@ActivePermissionScopes` (research R6); đăng ký trong `entitlement.module.ts`
- [X] T024 [P] [US2] Viết `src/routes/entitlement/test/entitlement.controller.spec.ts` phần My Products: controller chuyển đúng `userId` từ token vào service; và thêm vào `entitlement.service.spec.ts` case `listMine` tính `totalPages` đúng và output không chứa field quản trị (parse bằng `GetMyEntitlementsOutput.strict()` hoặc kiểm tra key)

**Checkpoint**: US1 + US2 = MVP (Admin cấp quyền, customer thấy quyền).

---

## Phase 5: User Story 3 - Admin thu hồi quyền (Priority: P2)

**Goal**: Admin thu hồi kèm lý do; quyền bị thu hồi chặn sử dụng; cấp lại thì gỡ thu hồi và giữ lịch sử.

**Independent Test**: quickstart S6: revoke → `REVOKED` + đủ revoke fields; revoke lần 2 → `409`;
`checkUsage` → `REVOKED`; grant lại → revoke fields `null`, `auditHistory` còn entry `REVOKE`.

### Implementation for User Story 3

- [X] T025 [US3] Thêm vào `src/routes/entitlement/entitlement.model.ts` `RevokeEntitlementInput` strict: `reason: z.string().trim().min(1).max(ENTITLEMENT_REASON_MAX_LENGTH)` (trim, 1..2000); DTO `RevokeEntitlementInputDTO` trong `entitlement.dto.ts`
- [X] T026 [US3] Thêm vào `src/routes/entitlement/entitlement.repo.ts`: `findCustomerIdById(id)` (không khoá); `lockByIdForUpdate(id)` → row + `transactionNowMs`; `revoke({ id, revokedById, reason, auditEntry })` — một câu `UPDATE` set `status='REVOKED'`, `revokedAt = now()`, `revokedById`, `revokedReason`, append `auditHistory`, `"updatedAt" = now()`, **giữ nguyên** `startsAt`, `expiresAt`, lịch sử mua (FR-031)
- [X] T027 [US3] Thêm `revoke({ entitlementId, reason, adminUserId })` vào `src/routes/entitlement/entitlement.service.ts` (public + private `@Transactional()`): `findCustomerIdById` null ⇒ `EntitlementNotFoundException`; `lockCustomerProfile(customerId)` (cùng thứ tự khoá R5; không khoá Product — revoke không phụ thuộc trạng thái Product); `lockByIdForUpdate`; `status === 'REVOKED'` ⇒ `EntitlementAlreadyRevokedException`; audit entry `{ action: 'REVOKE', before, after (kèm revokedAt/revokedById/revokedReason) }`; trả `toAdminOutput(findAdminById)`. Timeout ⇒ `EntitlementOperationTimeoutException`. Log như T015 (phụ thuộc T026)
- [X] T028 [US3] Thêm route `@Post(':entitlementId/revoke') @HttpCode(200) @ZodResponse({ type: AdminEntitlementOutputDTO })` vào `src/routes/entitlement/admin-entitlement.controller.ts` với `@Param() EntitlementIdParamDTO`, `@Body() RevokeEntitlementInputDTO`, `@ActiveUser('userId')`
- [X] T029 [P] [US3] Thêm vào `src/routes/entitlement/test/entitlement.service.spec.ts`: revoke quyền còn hạn và quyền đã hết hạn đều thành công, tham số repo giữ nguyên `expiresAt`; id không tồn tại → `EntitlementNotFoundException`; đã REVOKED → `EntitlementAlreadyRevokedException`; audit entry `REVOKE` có before/after đúng; grant sau revoke gọi `overwriteFromAdminGrant` (xoá revoke fields) và audit `before.status = 'REVOKED'`

**Checkpoint**: US1–US3 độc lập kiểm chứng được.

---

## Phase 6: User Story 4 - Admin tra cứu quyền (Priority: P3)

**Goal**: Admin lọc quyền theo customer và/hoặc Product, thấy đầy đủ thông tin quản trị và lịch sử
kiểm toán.

**Independent Test**: quickstart S8: `?customerId=` trả quyền với đủ field; tham số không phải uuid → `422`.

### Implementation for User Story 4

- [X] T030 [US4] Thêm vào `src/routes/entitlement/entitlement.model.ts` `GetAdminEntitlementsInput = PaginationQuerySchema.extend({ customerId: z.uuid().optional(), productId: z.uuid().optional() })` và `GetAdminEntitlementsOutput` (page của `AdminEntitlementOutput`); DTO tương ứng trong `entitlement.dto.ts`; thêm `listAdmin({ customerId?, productId?, skip, take })` + `countAdmin` vào `src/routes/entitlement/entitlement.repo.ts` (select đủ cột + `EFFECTIVE_STATUS_SQL`, `ORDER BY e."updatedAt" DESC NULLS LAST, e."createdAt" DESC, e.id ASC`) và `listAdmin(query)` vào `entitlement.service.ts` (map bằng `toAdminOutput`)
- [X] T031 [US4] Thêm route `@Get() @ZodResponse({ type: GetAdminEntitlementsOutputDTO })` với `@Query() GetAdminEntitlementsInputDTO` vào `src/routes/entitlement/admin-entitlement.controller.ts`; thêm test service `listAdmin` truyền đúng filter vào `src/routes/entitlement/test/entitlement.service.spec.ts`

**Checkpoint**: đủ 4 story.

---

## Phase 7: Order integration contract (FR-011)

**Purpose**: hai method nội bộ cho spec 007 dùng trong transaction mua. Không có route; chưa có
caller trong 006. Không có story label vì không thuộc user story nào của spec này.

- [X] T032 Thêm vào `src/routes/entitlement/entitlement.repo.ts` `upsertFromOrder({ customerId, productId, orderItemId, productOfferId, isOneTime, startsAt, expiresAt })` — một câu `INSERT … ON CONFLICT ("customerId","productId") DO UPDATE SET status='ACTIVE', "grantSource"='ORDER', "grantedById"=NULL, "startsAt", "expiresAt", "latestOrderItemId", "latestProductOfferId", "grantSnapshot", "oneTimePurchasedAt" = CASE WHEN $isOneTime THEN COALESCE("Entitlement"."oneTimePurchasedAt", $startsAt) ELSE "Entitlement"."oneTimePurchasedAt" END, "updatedAt"=now() RETURNING id, "startsAt", "expiresAt"`; **không** append `auditHistory` (FR-041). Trong 006 cột `latestOrderItemId` chưa có FK (R8)
- [X] T033 Thêm vào `src/routes/entitlement/entitlement.service.ts` hai method public **không** `@Transactional` (chạy trong transaction của caller — R2): `lockForPurchase({ customerId, productId })` → `findByCustomerProductForUpdate` map sang `{ id, status, expiresAt, oneTimePurchasedAt } | null`; `activateFromOrder({ customerId, productId, orderItemId, productOfferId, offerType, durationDays, now })` → `startsAt = now`, `expiresAt = durationDays === null ? null : now + durationDays ngày`, gọi `upsertFromOrder`. JSDoc ghi rõ: chỉ gọi sau khi caller đã khoá Product → ProductOffer → Profile (phụ thuộc T032)
- [X] T034 [P] Thêm test vào `src/routes/entitlement/test/entitlement.service.spec.ts`: `activateFromOrder` subscription 30 ngày tính `expiresAt = now + 30 ngày`; `durationDays = null` ⇒ `expiresAt = null`; `ONE_TIME` truyền `isOneTime = true`; `lockForPurchase` trả `null` khi chưa có row

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T035 Chạy `npm run seed:permissions` và xác nhận có 4 permission mới (`GET /api/v1/entitlements/me`, `GET /api/v1/admin/entitlements`, `POST /api/v1/admin/entitlements/grant`, `POST /api/v1/admin/entitlements/:entitlementId/revoke`) được gán cho ADMIN và cache role-permission đã bị xoá (Constitution II)
- [X] T036 Gán permission `GET /api/v1/entitlements/me` cho role `CUSTOMER` theo quickstart §1 (lấy danh sách hiện có rồi `PUT /roles/:id/permissions` với danh sách cũ **+** id mới — API thay toàn bộ tập); ghi bước này vào mô tả PR như bước vận hành bắt buộc khi deploy
- [X] T037 Chạy toàn bộ kịch bản quickstart S1–S8 trên môi trường dev, ghi kết quả từng kịch bản vào mô tả PR
- [X] T038 Chạy các câu SQL ở quickstart §3 và xác nhận cả 4 câu đều bị DB từ chối (FR-005, SC-003, SC-004)
- [X] T039 Chạy kịch bản đồng thời quickstart §4 (10 grant song song) và xác nhận đúng 1 row, `jsonb_array_length("auditHistory")` bằng số request `200`
- [X] T040 Chạy `npm run lint && npm test && npm run build`, sửa mọi lỗi (Constitution IV)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: không phụ thuộc.
- **Foundational (Phase 2)**: sau Phase 1; chặn mọi story.
- **US1 (Phase 3)**: sau Phase 2. Tạo `entitlement.dto.ts`, `admin-entitlement.controller.ts`, các hàm khoá `lockCustomerProfile`/`findByCustomerProductForUpdate` mà US3 và Phase 7 dùng lại.
- **US2 (Phase 4)**: sau Phase 2; độc lập về logic với US1 nhưng thêm DTO vào `entitlement.dto.ts` do T012 tạo → làm sau T012.
- **US3 (Phase 5)**: sau US1 (dùng `lockCustomerProfile`, `admin-entitlement.controller.ts`, và test "grant sau revoke").
- **US4 (Phase 6)**: sau US1 (dùng `admin-entitlement.controller.ts`, `toAdminOutput`).
- **Phase 7**: sau US1 (dùng `findByCustomerProductForUpdate`).
- **Polish (Phase 8)**: sau mọi phase cần kiểm chứng; T035–T036 cần đủ controller.

### Story completion order

```text
Phase 1 → Phase 2 → US1 ─┬─▶ US2
                         ├─▶ US3
                         ├─▶ US4
                         └─▶ Phase 7
                                    └─▶ Phase 8
```

### Within each story

model/DTO → repo → service → controller → test.

## Parallel Opportunities

- Phase 1: T001 ∥ T002 (T002 chỉ cần tên hằng của T001 — có thể viết song song rồi khớp tên).
- Phase 2: T006 ∥ T007 sau T005.
- US1: T012 ∥ T013; T019 viết song song khi T015/T017 xong.
- Sau US1: US2, US3, US4 và Phase 7 có thể giao cho người khác nhau, **nhưng** US3, US4 cùng sửa
  `admin-entitlement.controller.ts`, `entitlement.repo.ts`, `entitlement.service.ts` → cần
  merge tuần tự trên các file đó.

### Parallel Example: User Story 1

```text
Task: "T012 [P] [US1] Tạo entitlement.dto.ts"
Task: "T013 [US1] Thêm method khoá vào entitlement.repo.ts"
→ sau khi T015, T017 xong:
Task: "T019 [P] [US1] Viết entitlement.service.spec.ts"
```

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 → Phase 2.
2. US1: Admin cấp quyền + `checkUsage` — đủ để Download/Lease bắt đầu tích hợp.
3. US2: My Products — customer thấy quyền.
4. **Dừng và kiểm chứng**: quickstart S1–S5, S7 (+ T035, T036).

### Incremental Delivery

1. MVP (US1 + US2) → deploy.
2. US3 (thu hồi) → quickstart S6 → deploy.
3. US4 (tra cứu) → S8 → deploy.
4. Phase 7 (contract cho Order) → mở khoá spec 007.

## Notes

- Mỗi task một commit hoặc một nhóm logic; commit message theo convention repo.
- Không cập nhật tài liệu trong `a2matex-docs` (Assumption của spec).
- `planning-notes.md` không phải nguồn đúng khi mâu thuẫn với research/data-model/contracts.

## Implementation Status (2026-11-21)

Toàn bộ T001–T040 đã xong. Phase 8 kiểm chứng trên máy local: Postgres 17 trong container
(`npm run compose-up`), API chạy bằng **`npm run start:prod` (dist)** — không dùng `start:dev`, vì
`tsx` không emit decorator metadata nên DTO không được validate và các case `422` của S2/S8 sẽ không
đúng.

### Phase 2 — migration (T004, T005)

- Áp dụng `20261121090000_add_entitlement` bằng `npm run prisma:migrate:deploy`.
- DB rỗng: tạo database mới, chạy lại **toàn bộ** chuỗi migration từ đầu → tất cả apply sạch, và
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` trả
  **"No difference detected"** (DB dev local còn drift cũ ở bảng `Static`, không liên quan feature).
- `pg_constraint` / `pg_indexes` trên `Entitlement`: đủ 5 CHECK (`period`, `revoke_fields`,
  `granted_by`, `grantSnapshot_object`, `auditHistory_array`), unique index
  `Entitlement_customerId_productId_key`, index `Entitlement_productId_idx`, 5 FK.
- Lưu ý: `src/generated/prisma` trong working tree bị cũ (chưa có model `Entitlement`) làm
  `npm run build` fail — phải chạy lại `npm run prisma:generate` sau khi đổi schema.

### Phase 8 — kết quả từng kịch bản

| Task | Kịch bản | Kết quả |
| ---- | -------- | ------- |
| T035 | `npm run seed:permissions` | Added 8 permission (gồm đủ 4 route entitlement), gán ADMIN, "Cleared role permission cache" |
| T036 | Gán `GET /api/v1/entitlements/me` cho `CUSTOMER` | `PUT /roles/:id/permissions` với 5 id cũ + 1 id mới → role còn đủ 6 permission |
| T037 S1 | Admin grant lần đầu | `200`, `ACTIVE` / `ADMIN_GRANT`, `grantedById` = admin, 1 audit entry `before=null`; `GET /entitlements/me` thấy Product, không có field revoke/audit |
| T037 S2 | 5 request bị từ chối | DRAFT → `409 EntitlementProductNotActive`; `expiresAt` quá khứ → `422 EntitlementInvalidExpiresAt`; thiếu `expiresAt` → `422` validation; `reason="   "` → `422` validation; customer lạ → `404 EntitlementCustomerNotFound`; `count(*)` không đổi (1) |
| T037 S3 | Ghi đè rút ngắn | `200`, cùng `id`, `expiresAt` mới, `startsAt` = lúc cấp, 2 audit entry, entry 2 có `before.expiresAt` = giá trị S1 |
| T037 S4 | `expiresAt: null` | `200`, `expiresAt=null`, My Products `ACTIVE` |
| T037 S5 | Hết hạn suy ra lúc đọc | SQL đẩy `expiresAt` về quá khứ → My Products `EXPIRED`, admin thấy `status=EXPIRED` / `storedStatus=ACTIVE` |
| T037 S6 | Thu hồi và cấp lại | revoke → `200` `REVOKED` + đủ 3 revoke fields, `startsAt`/`expiresAt` giữ nguyên; revoke lần 2 → `409 EntitlementAlreadyRevoked`; My Products → `REVOKED` không lộ lý do; grant lại → `ACTIVE`, 3 revoke fields `null`, audit còn entry `REVOKE` (reason "vi pham") và entry cuối có `before.status=REVOKED`; revoke id lạ → `404 EntitlementNotFound` |
| T037 S7 | Cô lập dữ liệu | `$C2` không thấy quyền của `$C1` (`totalItems=0`); `$C1` gọi `GET /admin/entitlements` và `POST /admin/entitlements/grant` → `403` |
| T037 S8 | Admin tra cứu | `?customerId=` trả quyền với đủ field quản trị (gồm `auditHistory`, `storedStatus`); `?productId=` lọc đúng; `?productId=not-a-uuid` → `422 Invalid UUID` |
| T038 | 4 câu SQL quickstart §3 | Cả 4 đều bị từ chối (`revoke_fields_check` ×2, unique `customerId_productId_key`, `period_check`). Kiểm thêm 3 câu: `granted_by_check`, `grantSnapshot_object_check`, `auditHistory_array_check` cũng từ chối |
| T039 | 10 grant song song | 10/10 `200`, đúng **1** row, `jsonb_array_length("auditHistory") = 10` |
| T040 | `npm run lint && npm test && npm run build` | lint exit 0 (0 finding ở file entitlement, chỉ warning cũ nơi khác); test 24 file / 245 test pass; build pass sau khi `prisma:generate` |

### Việc vận hành bắt buộc khi deploy (ghi vào mô tả PR)

1. `npm run prisma:migrate:deploy` — migration `20261121090000_add_entitlement`.
2. `npm run seed:permissions` — tạo các permission route còn thiếu (gồm đủ 4 route entitlement) và
   gán cho `ADMIN`. Trên local lệnh này thêm 8 permission: 4 route entitlement + `POST /auth/google`,
   `POST /auth/github`, `GET /marketplace/products`, `GET /marketplace/products/:productId` chưa
   từng được seed. Bốn route sau đều `@IsPublic()` nên `AuthenticationGuard` bỏ qua bước kiểm
   permission — seed chúng vào ADMIN không chặn người dùng ẩn danh (đã thử lại: marketplace `200`,
   `/auth/google` trả `422` validation chứ không phải `401/403`). Số lượng mỗi môi trường tuỳ trạng
   thái hiện có.
3. Gán thủ công `GET /api/v1/entitlements/me` cho role `CUSTOMER`: lấy danh sách permission hiện có
   của role rồi `PUT /roles/:id/permissions` với **danh sách cũ + id mới** (API thay toàn bộ tập —
   thiếu id cũ là customer mất quyền).

### Bẫy để lại cho spec 007 (Order)

`upsertFromOrder` cố tình **không** xoá `revokedAt`/`revokedById`/`revokedReason`. Nếu Order gọi
`activateFromOrder` trên một quyền đang `REVOKED`, câu `ON CONFLICT DO UPDATE` sẽ đặt
`status='ACTIVE'` mà vẫn còn revoke fields → `Entitlement_revoke_fields_check` chặn, transaction
mua hàng abort (lỗi 500). Đây là lớp phòng vệ đúng theo Clarification "quyền bị thu hồi chặn mọi lần
mua mới", không phải bug của 006 — nhưng Order **phải** tự chặn trước: `lockForPurchase` đã trả
`status`, nên 007 chỉ cần kiểm tra `status === 'REVOKED'` và trả lỗi nghiệp vụ trước khi gọi
`activateFromOrder`. Đã kiểm chứng bằng SQL mô phỏng trong một transaction rollback.

### Điểm lệch nhỏ so với plan/tasks (cùng ngữ nghĩa)

- T008/research R3: trạng thái hiển thị tính bằng hàm thuần `toEffectiveStatus(status, expiresAt,
  now)` với `now` lấy từ `now()` của DB (`getDatabaseNow()` hoặc `transactionNow`), thay cho
  `CASE` trong SQL — vẫn một nguồn thời gian (FR-012), dễ unit test hơn. `checkUsage` vẫn so sánh
  hết hạn trong SQL.
- Phân trang cap `limit ≤ 100` (giống `ADMIN_USER_PAGE_SIZE_MAX`) thay vì `PaginationQuerySchema`
  không giới hạn.
- `publisher.displayName` nullable (Profile của chủ Publisher có thể không tồn tại).
