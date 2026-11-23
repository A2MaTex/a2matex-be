---

description: "Task list cho System Setting — phase 1 của module payout"
---

# Tasks: System Setting — kho cấu hình runtime cho admin

**Input**: design documents trong `specs/009-system-setting/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/system-setting-api.md](./contracts/system-setting-api.md),
[quickstart.md](./quickstart.md)

**Tests**: CÓ. Plan nêu đích danh 3 file test và Nguyên tắc IV của constitution bắt `npm test` phải
pass trước khi mở PR. Test đặt ở `src/routes/system-setting/test/` theo quy ước 22 file test sẵn có.

**Branch**: `feat/system-setting`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1 / US2 / US3, ánh xạ sang user story trong spec.md

---

## Phase 1: Setup — bảng và schema

**Mục đích**: dựng bảng. Mọi thứ còn lại đọc từ đây.

- [X] T001 Tạo migration rỗng bằng `npm run prisma:migrate:create`, đặt tên `add_system_setting`, file sinh ra ở `prisma/migrations/<timestamp>_add_system_setting/migration.sql`
- [X] T002 Viết SQL tạo bảng `SystemSetting` trong `prisma/migrations/<timestamp>_add_system_setting/migration.sql`: `id UUID PK DEFAULT gen_random_uuid()`, `key VARCHAR(100) NOT NULL UNIQUE`, `value JSONB NOT NULL`, `createdAt TIMESTAMPTZ NOT NULL DEFAULT now()`, `updatedAt TIMESTAMPTZ`, `updatedById UUID REFERENCES "User"(id) ON DELETE NO ACTION`, `auditHistory JSONB NOT NULL DEFAULT '[]'` — sao đúng mục 4 của [data-model.md](./data-model.md)
- [X] T003 Thêm 4 check constraint vào cùng file migration: `SystemSetting_value_object_check` (`jsonb_typeof(value) = 'object'`), `SystemSetting_auditHistory_array_check` (`jsonb_typeof("auditHistory") = 'array'`), `SystemSetting_updatedBy_check` (`("updatedAt" IS NULL) = ("updatedById" IS NULL)`), và `SystemSetting_commissionRate_check` (`key <> 'COMMISSION_RATE_BPS' OR ((value ->> 'rateBps')::int BETWEEN 0 AND 10000)`)
- [X] T004 Thêm câu `INSERT` seed đủ **4 dòng** vào cùng file migration: `COMMISSION_RATE_BPS` = `{"rateBps": 3000}`, `SEPAY_BANK_ACCOUNT_NUMBER` / `SEPAY_BANK_NAME` / `SEPAY_BANK_ACCOUNT_HOLDER` = `{"value": ""}`. Ba dòng rỗng là bắt buộc, không phải tuỳ chọn — lý do ở [research.md](./research.md) R6
- [X] T005 Chạy `npm run prisma:migrate:deploy` trên database local và kiểm bằng quickstart §1 rằng có đúng 4 dòng, `updatedAt` của cả 4 đều `NULL`
- [X] T006 Cập nhật `prisma/schema.prisma` theo quy trình SQL-first của repo rồi chạy `npm run prisma:generate` — bỏ qua bước generate sẽ làm `npm run build` fail với TS2694 vì `src/generated/prisma` còn cũ
- [X] T007 [P] Tạo entity schema `src/entities/system-setting.model.ts` với các trường `id`, `key`, `value`, `createdAt`, `updatedAt`, `updatedById`, `auditHistory`
- [X] T008 [P] Tạo `src/shared/constants/system-setting.constant.ts` khai báo hằng tên 4 khóa

**Checkpoint**: bảng tồn tại trên database local với đủ 4 dòng và 4 constraint.

---

## Phase 2: Foundational — cơ chế registry, repo, service

**Mục đích**: phần lõi dùng chung cho cả 3 user story. Chưa lộ HTTP, chưa khai báo khóa cụ thể.

**⚠️ Không user story nào bắt đầu được trước khi phase này xong.**

- [X] T009 Tạo cơ chế registry trong `src/routes/system-setting/system-setting.registry.ts`: kiểu một mục khai báo (Zod schema, mô tả, mô tả kiểu dữ liệu), map khóa→mục, hàm tra cứu, và kiểu `SettingKey` / `SettingValue<K>` suy ra từ schema. **Chưa khai báo khóa nào** — khóa cụ thể thuộc về từng user story
- [X] T010 [P] Tạo `src/routes/system-setting/system-setting.error.ts` với `SystemSettingKeyNotRegisteredException` = `new NotFoundException('Error.SystemSettingKeyNotRegistered')`, theo đúng quy ước của `src/routes/order/order.error.ts`
- [X] T011 Tạo `src/routes/system-setting/system-setting.repo.ts`: đọc một dòng theo `key`, đọc nhiều dòng theo danh sách `key`, và cập nhật giá trị kèm append `auditHistory` **trong cùng một câu lệnh raw SQL** dạng `"auditHistory" = COALESCE("auditHistory", '[]'::jsonb) || jsonb_build_array(${entry}::jsonb)` — sao đúng pattern ở `user.repo.ts:206`, `entitlement.repo.ts:249`
- [X] T012 Tạo `src/routes/system-setting/system-setting.service.ts` với `get<K extends SettingKey>(key: K): Promise<SettingValue<K>>` tra registry trước rồi parse giá trị theo schema của chính khóa đó, và `update()` ghi kèm phần tử audit `{ at, by, from, to }` cùng `updatedAt` / `updatedById`
- [X] T013 Thêm `OnModuleInit` vào `SystemSettingService`: lúc khởi động nạp mọi khóa đã khai báo trong registry, parse theo schema từng khóa, `throw` nếu thiếu dòng hoặc parse hỏng — bám pattern `src/shared/services/key.service.ts:21-34`
- [X] T014 Tạo `src/routes/system-setting/system-setting-core.module.ts` **không có `controllers`**, provide và export `SystemSettingService` + `SystemSettingRepo`. Đây là module mà `CronModule` sẽ gián tiếp import; có controller ở đây sẽ làm route admin lộ trên cổng cron ([research.md](./research.md) R2)
- [X] T015 [P] Viết `src/routes/system-setting/test/system-setting.registry.spec.ts`: tra khóa không khai báo trả về không tìm thấy; tra khóa đã khai báo trả đúng mục
- [X] T016 [P] Viết `src/routes/system-setting/test/system-setting.repo.spec.ts`: một lần update làm `auditHistory` dài thêm **đúng 1** phần tử, với `from` là giá trị cũ và `to` là giá trị mới
- [X] T017 [P] Viết `src/routes/system-setting/test/system-setting.service.spec.ts`: `OnModuleInit` ném lỗi khi thiếu dòng của một khóa đã khai báo, và khi giá trị lưu không parse được. Test **tự dựng một registry giả** thay vì dùng registry thật — ở Phase 2 registry chưa khai báo khóa nào, nên dựa vào khóa thật sẽ khiến test không kiểm được gì. Đừng khai báo khóa sớm để test chạy: như vậy sẽ phá cách chia phase

**Checkpoint**: lõi chạy được, `npm test` xanh, chưa có route nào.

---

## Phase 3: User Story 1 — Đổi tài khoản ngân hàng nhận tiền nạp (P1) 🎯 MVP

**Goal**: admin đổi số tài khoản / tên ngân hàng / chủ tài khoản từ API, màn hình nạp tiền của
khách thấy giá trị mới ngay mà không khởi động lại tiến trình.

**Independent Test**: gọi `PATCH` đổi số tài khoản, rồi gọi `POST /topups` bằng token khách và
thấy số mới — không restart (quickstart §8).

### Khai báo khóa và đường ghi

- [X] T018 [US1] Khai báo 3 khóa SePay trong `src/routes/system-setting/system-setting.registry.ts`: `SEPAY_BANK_ACCOUNT_NUMBER` schema `z.object({ value: z.string().max(50) })`, `SEPAY_BANK_NAME` và `SEPAY_BANK_ACCOUNT_HOLDER` schema `z.object({ value: z.string().max(255) })`. Chuỗi rỗng **hợp lệ** ở tầng schema — chặn giá trị rỗng là việc của bên đọc
- [X] T019 [P] [US1] Tạo `src/routes/system-setting/system-setting.model.ts` với Zod schema cho param `key`, body `{ value: <JSON object> }` và output một bản ghi cấu hình
- [X] T020 [US1] Tạo `src/routes/system-setting/system-setting.dto.ts` bọc các schema trên bằng `createZodDto` của `nestjs-zod`, theo đúng `src/routes/studio-release/studio-release.dto.ts`
- [X] T021 [US1] Tạo `src/routes/system-setting/system-setting.controller.ts` với `@Controller('admin/system-settings')`, `@ApiTags('System Settings')`, `@ApiBearerAuth('access-token')` và route `PATCH :key` nhận `@ActiveUser('userId')` làm người sửa. **Chưa làm route `GET`** — thuộc US3
- [X] T022 [US1] Tạo `src/routes/system-setting/system-setting.module.ts` (có controller, import core module) và import nó vào `src/app.module.ts`
- [X] T023 [US1] Chạy `npm run seed:permissions` và kiểm theo quickstart §9 rằng bảng `Permission` có dòng `PATCH /api/v1/admin/system-settings/:key`, đồng thời script đã in dòng xoá cache role-permission

### Chuyển bên tiêu thụ sang đọc từ cấu hình

- [X] T024 [US1] Sửa `src/routes/topup/topup.service.ts`: `getBankTransferConfig()` đọc 3 khóa qua `SystemSettingService` thay vì `envConfig`, đổi thành `async`, và nơi gọi trong `createTopUpRequest` phải `await`. Giữ nguyên guard giá trị rỗng ở dòng 48 cùng lỗi `Error.SepayBankTransferNotConfigured`. Task này đổi constructor của `TopUpService`; **đã kiểm: không có file test nào dựng `TopUpService`** (`src/routes/topup/test/` không tồn tại), nên không có test cũ phải sửa theo
- [X] T025 [US1] Sửa `src/routes/topup/topup-core.module.ts` import `SystemSettingCoreModule` — **không** import `SystemSettingModule`, vì `CronModule` import `TopUpCoreModule` và sẽ kéo theo controller lên cổng cron
- [X] T026 [US1] Tạo `src/seed/seed-system-settings.ts` đọc **thẳng `process.env.SEPAY_BANK_*`**, không đi qua `envConfig` — để khi Phase 7 gỡ 3 biến khỏi `configSchema` thì script này không phải sửa. Nạp giá trị vào các dòng tương ứng, **chỉ ghi vào dòng đang rỗng**, và để `updatedAt` / `updatedById` **cùng null** — constraint `SystemSetting_updatedBy_check` bắt hai trường này cùng null hoặc cùng khác null, và không có người nào thực sự sửa
- [X] T027 [US1] Thêm script `"seed:settings": "tsx src/seed/seed-system-settings.ts"` vào `package.json`

### Verify

- [X] T028 [US1] Chạy quickstart §7 trên database local: khởi động `npm run start:cron`, gọi `/api/v1/admin/system-settings` vào cổng `CRON_PORT` và xác nhận nhận **404**
- [X] T029 [US1] Chạy quickstart §3, §8 và §10 trên bản build (`npm run build && npm run start:prod`) — **không dùng `start:dev`**, vì `tsx` không emit decorator metadata nên DTO không được xác thực

**Checkpoint**: US1 chạy độc lập được. Đây là MVP của phase 1.

---

## Phase 4: User Story 2 — Đặt tỉ lệ hoa hồng cho sàn (P2)

**Goal**: admin đặt được tỉ lệ hoa hồng, giá trị lưu và đọc lại đúng, giá trị sai bị chặn ở cả hai
tầng. Chưa có bên tiêu thụ — phase 2 của payout sẽ là bên đọc đầu tiên.

**Independent Test**: đặt rate `2500`, đọc lại thấy `2500`; đặt `10001` bị từ chối; ghi thẳng SQL
`-1` bị database từ chối (quickstart §4, §5).

**Lưu ý**: `SystemSetting_commissionRate_check` đã ship ở T003. Tách một câu constraint ra khỏi file
migration của chính nó để nhét vào phase này sẽ tệ hơn là để nguyên, nên phase này tập trung vào
phần xác thực ở tầng ứng dụng và vào việc chứng minh cả hai tầng đều chặn.

- [X] T030 [US2] Khai báo `COMMISSION_RATE_BPS` trong `src/routes/system-setting/system-setting.registry.ts` với schema `z.object({ rateBps: z.number().int().min(0).max(10000) })` và mô tả "Tỉ lệ hoa hồng sàn giữ lại trên mỗi đơn hàng, tính bằng basis point (3000 = 30%)"
- [X] T031 [P] [US2] Bổ sung ca kiểm thử vào `src/routes/system-setting/test/system-setting.registry.spec.ts`: `rateBps` là chuỗi bị từ chối, `-1` bị từ chối, `10001` bị từ chối, `0` và `10000` được chấp nhận
- [X] T032 [US2] Chạy quickstart §5 kiểm database từ chối `UPDATE` thẳng với `{"rateBps": -1}` và `{"rateBps": 20000}`; ghi nhận rằng `{"foo": 1}` **được** chấp nhận ở tầng DB, đúng như giới hạn đã lường trước ở [research.md](./research.md) R4
- [X] T033 [US2] Chạy quickstart §4 trên bản build, xác nhận trả `422` cho giá trị sai kiểu và ngoài khoảng, và `COMMISSION_RATE_BPS` giữ nguyên giá trị cũ sau cả hai lần thử

**Checkpoint**: US1 và US2 đều chạy độc lập.

---

## Phase 5: User Story 3 — Admin Portal tự dựng được form (P3)

**Goal**: một route trả về mọi khóa đã khai báo kèm mô tả và mô tả kiểu dữ liệu, đủ để giao diện
dựng ô nhập mà không hardcode danh sách khóa.

**Independent Test**: gọi `GET /admin/system-settings`, mỗi mục có `description` và `valueSchema`;
thêm một khóa thứ 5 vào registry thì nó tự xuất hiện mà không sửa gì khác (quickstart §2).

- [X] T034 [US3] Bổ sung `description` và `valueSchema` cho cả 4 mục trong `src/routes/system-setting/system-setting.registry.ts` — `valueSchema` là mô tả rút gọn tự khai (`type`, `fields` với `name`/`type`/`min`/`max`/`maxLength`), **không** sinh JSON Schema đầy đủ từ Zod
- [X] T035 [US3] Thêm schema output danh sách vào `src/routes/system-setting/system-setting.model.ts` và DTO tương ứng trong `system-setting.dto.ts`
- [X] T036 [US3] Thêm route `GET` vào `src/routes/system-setting/system-setting.controller.ts`, lấy danh sách khóa từ **registry** (không phải từ bảng) rồi ghép giá trị hiện tại đọc từ repo
- [X] T037 [US3] Chạy lại `npm run seed:permissions` để sinh permission cho route `GET` và kiểm quickstart §9 thấy đủ **2** dòng permission
- [X] T038 [US3] Chạy quickstart §2, xác nhận 4 mục đều có đủ `description` và `valueSchema`

**Checkpoint**: cả 3 user story chạy độc lập.

---

## Phase 6: Polish & hoàn tất

- [X] T039 [P] Cập nhật `.env.example` và `.env.production.example`: thêm ghi chú rằng 3 giá trị ngân hàng SePay nay nằm trong `SystemSetting`, chưa gỡ biến ở bước này
- [X] T040 Chạy `npm run lint`, `npm test`, `npm run build` — cả ba phải pass (Nguyên tắc IV). Chú ý `typescript/no-floating-promises` ở mức lỗi sẽ bắt chỗ quên `await` sau khi `getBankTransferConfig()` thành async
- [X] T041 Chạy trọn bộ 11 kịch bản trong [quickstart.md](./quickstart.md) trên database local, đối chiếu bảng nghiệm thu ở cuối file
- [X] T042 Cập nhật `docs/deployment-runbook.md` thêm mục quy trình chuyển đổi hai bước: bước 1 chạy `migrate deploy` rồi `npm run seed:settings` khi `.env.production` **vẫn còn** 3 biến SePay; bước 2 là PR riêng

**Checkpoint**: sẵn sàng mở PR cho deploy bước 1.

---

## Phase 7: Deploy bước 2 — PR RIÊNG, merge sau

**⚠️ Không gộp vào PR của Phase 1–6.** Nếu gộp, lúc `seed:settings` chạy trên production thì 3 biến
đã bị gỡ khỏi `config.ts` và không còn gì để đọc — 3 dòng cấu hình sẽ vĩnh viễn rỗng và màn hình
nạp tiền trả `503`.

**Điều kiện bắt đầu**: deploy bước 1 đã lên `staging`, đã chạy `seed:settings`, và đã xác minh bằng
SQL rằng 3 dòng ngân hàng trên production có giá trị thật.

- [ ] T043 Gỡ `SEPAY_BANK_ACCOUNT_NUMBER`, `SEPAY_BANK_NAME`, `SEPAY_BANK_ACCOUNT_HOLDER` khỏi `configSchema` trong `src/shared/config.ts`
- [ ] T044 [P] Gỡ 3 biến đó khỏi `.env.example` và `.env.production.example`
- [ ] T045 [P] Xác minh `src/seed/seed-system-settings.ts` vẫn biên dịch và chạy được sau khi 3 biến rời `configSchema` — T026 đã cho script đọc thẳng `process.env` nên dự kiến **không phải sửa gì**; thêm ghi chú ở đầu file rằng script chỉ dùng cho lần chuyển đổi này
- [ ] T046 Chạy lại `npm run lint`, `npm test`, `npm run build`; xác nhận không còn tham chiếu nào tới 3 biến bằng `grep -rn "SEPAY_BANK" src --exclude-dir=generated`
- [ ] T047 Sau khi merge, gỡ 3 biến khỏi `.env.production` trên VPS và dựng lại container

---

## Dependencies & Execution Order

### Phụ thuộc giữa các phase

- **Phase 1 (Setup)**: không phụ thuộc gì, bắt đầu ngay
- **Phase 2 (Foundational)**: cần Phase 1 xong — **chặn toàn bộ user story**
- **Phase 3, 4, 5 (US1, US2, US3)**: đều cần Phase 2 xong
- **Phase 6 (Polish)**: cần các user story muốn ship đã xong
- **Phase 7 (Deploy bước 2)**: cần Phase 6 **đã deploy và xác minh trên production**

### Phụ thuộc giữa các user story

- **US1 (P1)**: độc lập sau Phase 2
- **US2 (P2)**: độc lập sau Phase 2. Không phụ thuộc US1
- **US3 (P3)**: cần controller và module đã dựng ở T021–T022 của US1. Đây là phụ thuộc thật và cố
  ý: dựng khung controller hai lần sẽ tệ hơn. Nếu muốn US3 hoàn toàn độc lập thì tách T021–T022
  lên Phase 2 — nhưng khi đó Phase 2 sẽ có controller, và không còn kiểm được T028 (route không lộ
  trên cổng cron) cho tới khi US1 xong

### Chỗ chạy song song được

- T007, T008 song song sau T006
- T010, T015, T016, T017 song song trong Phase 2
- T019 song song với T018
- T031 song song với T030
- T039, T044, T045 song song
- **US1 và US2 chạy song song hoàn toàn** sau Phase 2 nếu có hai người — US2 chỉ đụng registry và
  test, US1 đụng controller, topup và seed. Riêng file `system-setting.registry.ts` bị cả T018 và
  T030 sửa, nên hai task đó phải nối tiếp hoặc merge tay

---

## Parallel Example: Phase 2

```bash
# Sau khi T009 (cơ chế registry) xong, chạy song song:
Task: "T010 Tạo system-setting.error.ts"
Task: "T015 Viết test registry"
Task: "T016 Viết test repo"
Task: "T017 Viết test service"
```

---

## Implementation Strategy

### MVP trước (chỉ US1)

1. Phase 1: Setup — bảng, migration, 4 dòng seed
2. Phase 2: Foundational — registry, repo, service, startup check *(chặn mọi thứ)*
3. Phase 3: US1 — đổi được tài khoản ngân hàng, nạp tiền đọc từ cấu hình
4. **DỪNG VÀ KIỂM** — chạy quickstart §1, §3, §7, §8, §9, §10
5. Phase 6 + Phase 7 để hoàn tất chuyển đổi

Tới đây đã có giá trị dùng được: đổi tài khoản ngân hàng không cần SSH vào VPS.

### Giao từng phần

1. Setup + Foundational → lõi sẵn sàng
2. US1 → kiểm độc lập → deploy bước 1 (MVP)
3. US2 → kiểm độc lập → tỉ lệ hoa hồng sẵn sàng cho payout phase 2
4. US3 → kiểm độc lập → Admin Portal dựng form được
5. Deploy bước 2 → chỉ còn một nguồn sự thật

### Không làm gì ở phase này

Không có logic chia hoa hồng, ví, sổ cái, rút tiền, hoàn tiền. `COMMISSION_RATE_BPS` được lưu và
đọc được nhưng **chưa ai tiêu thụ** — payout phase 2 là bên đọc đầu tiên.

---

## Notes

- `[P]` = khác file, không phụ thuộc nhau
- Mọi kiểm thử validation phải chạy trên bản build (`npm run build && npm run start:prod`); chạy
  `npm run start:dev` sẽ cho kết quả sai vì `tsx` không emit decorator metadata
- Mọi migrate / seed / test chạy trên database local (`npm run compose-up`), không đụng Cloud SQL
- Commit sau mỗi task hoặc mỗi nhóm hợp lý; dừng ở bất kỳ checkpoint nào để kiểm độc lập
