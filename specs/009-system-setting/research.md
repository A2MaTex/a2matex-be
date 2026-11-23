# Research & Verification: System Setting (phase 1)

**Ngày**: 2026-11-23 · **Spec**: [spec.md](./spec.md)

Tài liệu này làm hai việc: đối chiếu từng giả định trong spec với mã nguồn thật, và chốt các quyết
định kỹ thuật còn mở trước khi viết tasks.

## Phần 1 — Đối chiếu giả định của spec

| # | Giả định trong spec | Kết quả | Bằng chứng |
|---|---------------------|---------|------------|
| A1 | Phase 1 chưa có bên nào tiêu thụ tỉ lệ hoa hồng | **Đúng** | `grep -rn "commission" src --exclude-dir=generated` → 0 kết quả |
| A2 | Có đường đọc thật cho 3 trường ngân hàng SePay | **Đúng** | `topup.service.ts:42-58` `getBankTransferConfig()`, gọi từ `createTopUpRequest` |
| A3 | Chỉ vai trò admin sửa cấu hình | **Đúng** | `RoleName.Admin` trong `role.constant.ts`; `create-permissions.ts:262` gán mọi permission `scope: null` cho role Admin |
| A4 | Cần invalidate cache role-permission sau khi seed | **Đúng, và đã có sẵn** | `create-permissions.ts:302-327` tự xoá `ROLE_PERMISSION_CACHE_PREFIX` sau mỗi lần seed |
| A5 | `auditHistory` có convention sẵn để bám theo | **Đúng** | `user.repo.ts:206`, `publisher.repo.ts:412`, `entitlement.repo.ts:249` — cùng một dạng SQL |
| A6 | Ứng dụng từ chối khởi động khi thiếu cấu hình | **Đúng về mục tiêu, sai về cách làm** | Xem R1 |
| A7 | Vài chục khóa, đọc thưa, chưa cần cache | **Đúng** | 4 khóa ở phase 1; đường đọc duy nhất là `POST /topups`, không phải route nóng |
| A8 | Hai admin sửa đồng thời là hiếm, chấp nhận ghi-sau-thắng | **Giữ nguyên** | Không có bằng chứng ngược lại; `auditHistory` vẫn giữ đủ dấu vết cả hai lần |
| A9 | `staging` đang là kênh production thật | **Đúng** | Constitution mục Development Workflow |

### Hai giả định hoá ra rẻ hơn dự kiến

**A3 + A4 — không phải viết permission record bằng tay.** `src/seed/create-permissions.ts` dùng
TypeScript compiler API quét thẳng các decorator `@Controller`/`@Get`/`@Patch` trong mã nguồn, tự
đồng bộ bảng `Permission`, tự gán cho role Admin, rồi tự xoá cache Redis. Nghĩa là FR-011 và
FR-011b được thoả mãn chỉ bằng việc **chạy `npm run seed:permissions`** sau khi controller tồn tại,
không có bước soạn dữ liệu thủ công nào. Ghi lại ở đây vì spec viết như thể đó là việc phải làm tay.

### Một giả định hoá ra phải đổi cách làm

**A6 — không dùng được cơ chế fail-at-startup hiện tại.** `src/shared/config.ts:~310` gọi
`safeParse(process.env)` ngay lúc import module rồi `process.exit(1)` nếu hỏng. Cơ chế đó chạy
*trước khi* có dependency injection và trước khi có kết nối database, nên cấu hình nằm trong
database không thể kiểm tra bằng đường này. Xem quyết định R1.

## Phần 2 — Quyết định kỹ thuật

### R1 — Kiểm tra cấu hình lúc khởi động bằng `OnModuleInit`

**Quyết định**: `SystemSettingService` implement `OnModuleInit`; lúc khởi động nạp toàn bộ khóa đã
khai báo, parse theo Zod schema của từng khóa, và `throw` nếu thiếu bản ghi hoặc parse hỏng.
NestJS sẽ không bootstrap được, tiến trình dừng.

**Lý do**: đây đúng là pattern mà `KeyService` đang dùng cho `MASTER_KEY`
(`key.service.ts:21-34` — `onModuleInit` ném lỗi khi khoá thiếu hoặc sai định dạng). Đó cũng là
nơi duy nhất trong repo hiện dùng `OnModuleInit`, nên không phải phát minh quy ước mới. Giữ được
tinh thần Nguyên tắc I: không chạy tiếp với giá trị đoán.

**Phương án đã loại**: kiểm tra lười lúc đọc lần đầu — bị loại vì biến lỗi cấu hình thành lỗi ở
request đầu tiên, đúng hình dạng sự cố MASTER_KEY ngày 17/11.

### R2 — Tách `SystemSettingCoreModule` và `SystemSettingModule`

**Quyết định**: hai module. `SystemSettingCoreModule` chứa service + repo, **không có controller**.
`SystemSettingModule` chứa controller và import core.

**Lý do**: đây là phát hiện quan trọng nhất của phần research. `TopUpService` sẽ phải inject
`SystemSettingService` (FR-015), mà `TopUpCoreModule` **đang được `CronModule` import**
(`src/cron/cron.module.ts:4`). Comment ngay trong file đó nói rõ lý do tồn tại của kiểu tách này:

> No controllers here, and only import modules without controllers (TopUpCoreModule, not
> TopUpModule): anything imported would expose its routes on the cron port.

Nếu gộp một module duy nhất có controller, **hai route admin sửa cấu hình sẽ lộ ra trên cổng của
cron server**. Cron server không có cùng lớp bảo vệ mạng với app chính, nên đây là lỗ hổng chứ
không phải chuyện gọn gàng.

**Hệ quả kèm theo**: tiến trình cron cũng sẽ chạy kiểm tra khởi động ở R1. Đây là hành vi mong
muốn — job đối soát SePay cũng không nên chạy với cấu hình hỏng.

**Đã kiểm tiến trình thứ ba — consumer thì không bị ảnh hưởng.** Repo có ba điểm vào:
`src/main.ts`, `src/cron/main.ts`, `src/consumer/main.ts`. `ConsumerModule`
(`src/consumer/consumer.module.ts`) import `SharedModule`, `SubmissionScanModule` và
`ProductReleaseModule`, **không nhánh nào với tới `TopUpCoreModule`**
(`grep -rn "TopUpCoreModule" src/routes/product-release/ src/routes/submission/` → 0 kết quả).
Nên `SystemSettingCoreModule` sẽ không bị kéo vào tiến trình consumer, và consumer không cần kiểm
tra khởi động ở R1. Nếu sau này có handler consumer cần đọc cấu hình thì kết luận này phải xem lại.

**Quan sát ngoài phạm vi**: `ConsumerModule` đang import `ProductReleaseModule`, mà module đó
**có** `controllers` (`product-release.module.ts:25`). Tức là kỷ luật "chỉ import module không có
controller" hiện chỉ được áp cho cron, không áp cho consumer. Đây là tình trạng có sẵn, không phải
do thay đổi lần này gây ra và không thuộc phạm vi phase 1 — ghi lại để ai đọc R2 không hiểu nhầm
rằng cả ba tiến trình đều đang theo cùng một kỷ luật.

### R3 — Giá trị lưu dạng JSONB, không phải cột kiểu riêng

**Quyết định**: một cột `value JSONB` cho mọi khóa, hình dạng do registry phía mã nguồn quy định.

**Lý do**: 4 khóa phase 1 đã có 2 hình dạng khác nhau (số nguyên và chuỗi), và phase 4 sẽ thêm
`WITHDRAWAL_MIN_AMOUNT` kiểu BIGINT-dạng-chuỗi. Cột riêng cho từng kiểu sẽ thành ba cột nullable mà
mỗi dòng chỉ dùng một. Repo đã có helper `zJsonObject` (`src/shared/utils/zod.ts:46`) và tiền lệ
`Entitlement.grantSnapshot`, `Order.offerSnapshot` đều là JSONB có schema ở tầng ứng dụng.

**Phương án đã loại**: `value TEXT` rồi tự parse — mất khả năng đặt check constraint cho khóa tiền
(FR-005).

### R4 — Check constraint chỉ áp cho đúng khóa tiền

**Quyết định**:

```sql
CONSTRAINT "SystemSetting_commissionRate_check" CHECK (
    key <> 'COMMISSION_RATE_BPS'
    OR ((value ->> 'rateBps')::int BETWEEN 0 AND 10000)
)
```

**Lý do**: FR-005 đòi chặn ở tầng database để giá trị sai không vào được kể cả khi ghi thẳng bằng
SQL. Ràng buộc viết theo dạng "khóa khác thì luôn đúng" nên không ảnh hưởng khóa còn lại và không
phải sửa mỗi khi thêm khóa mới.

**Rủi ro đã biết**: nếu `value` của khóa đó không có trường `rateBps`, `(value->>'rateBps')::int`
sẽ là `NULL` và `NULL BETWEEN ...` cho `NULL` → constraint coi như **không vi phạm**. Tức là
constraint chặn được giá trị sai *khoảng*, nhưng không chặn được giá trị *thiếu trường*. Tầng ứng
dụng (Zod) chặn phần đó. Ghi lại để không ai hiểu nhầm là DB đã bao hết.

### R5 — Append `auditHistory` bằng raw SQL, không đọc-sửa-ghi

**Quyết định**: dùng đúng dạng đã có trong repo:

```sql
"auditHistory" = COALESCE("auditHistory", '[]'::jsonb) || jsonb_build_array(${entry}::jsonb)
```

**Lý do**: append nguyên tử trong một câu lệnh. Đọc mảng ra rồi ghi đè sẽ làm mất lịch sử của lần
sửa song song — chính là tình huống A8 chấp nhận ghi-sau-thắng *về giá trị*, nhưng không chấp nhận
mất dấu vết. Ba module đang dùng dạng này: `user.repo.ts:206`, `publisher.repo.ts:412`,
`entitlement.repo.ts:249`.

### R6 — Migration tạo đủ 4 dòng, 3 dòng ngân hàng rỗng

**Quyết định**: migration `INSERT` cả 4 khóa. `COMMISSION_RATE_BPS` = `{"rateBps": 3000}`, ba khóa
ngân hàng = `{"value": ""}`.

**Lý do**: thứ tự deploy theo Nguyên tắc III là `migrate deploy` rồi mới thay container. Nếu
migration không tạo sẵn ba dòng ngân hàng thì container mới sẽ fail ở R1 (thiếu bản ghi) và bước
nạp giá trị không bao giờ chạy tới — hệ thống kẹt cứng. Dòng rỗng là thứ phá vòng kẹt đó.

Chuỗi rỗng hợp lệ ở tầng schema; chặn giá trị rỗng là việc của bên đọc (FR-018), và
`topup.service.ts:48` **đã có sẵn** guard đó cùng lỗi `Error.SepayBankTransferNotConfigured`.

### R7 — Quy trình chuyển đổi hai bước deploy

**Quyết định**:

| Bước | Hành động | Trạng thái sau bước |
|------|-----------|---------------------|
| 1 | Merge `staging`: migration + module + seed script. `.env.production` **vẫn còn** 3 biến SePay. Chạy `npm run seed:settings` để nạp giá trị từ biến môi trường vào 3 dòng rỗng. | DB có giá trị thật; `config.ts` vẫn khai báo 3 biến (không dùng tới) |
| 2 | Merge `staging`: gỡ 3 biến khỏi `config.ts`, `.env.example`, `.env.production.example`; gỡ khỏi `.env.production` trên VPS. | Chỉ còn một nguồn sự thật là database |

**Lý do**: seed script là thứ duy nhất đọc được *cả* biến môi trường *và* database, nên nó là cầu
nối. Migration SQL không đọc được biến môi trường. Giữa hai bước hệ thống luôn có giá trị đúng để
trả về cho khách.

**Phương án đã loại**: để `SystemSettingService` fallback sang biến môi trường khi giá trị rỗng —
bị loại vì vi phạm Nguyên tắc I (fallback âm thầm) và vì lớp tương thích đó sẽ không ai nhớ gỡ.

### R8 — `getBankTransferConfig()` chuyển thành bất đồng bộ

**Quyết định**: `TopUpService.getBankTransferConfig()` đổi thành `async`, `createTopUpRequest` phải
`await` nó.

**Lý do**: hệ quả cơ học của việc đọc từ database thay vì từ đối tượng config đã nạp sẵn. Nêu ra
để tasks không bỏ sót — oxlint bật `typescript/no-floating-promises` ở mức lỗi nên quên `await` sẽ
chặn ở lint chứ không lọt xuống runtime.

### R9 — Không cache ở phase 1

**Quyết định**: mỗi lần đọc là một truy vấn theo khóa duy nhất, không qua Redis.

**Lý do**: Nguyên tắc VI (YAGNI). Đường đọc duy nhất hiện nay là `POST /topups`, không phải route
nóng. Khi phase 2 đưa việc đọc tỉ lệ hoa hồng vào trong transaction mua hàng thì vẫn là một lần
đánh index duy nhất. Thêm cache lúc này còn kéo theo bài toán vô hiệu hoá cache mỗi lần admin sửa.

## Phần 3 — Những thứ đã kiểm tra và không thành vấn đề

- **Không có bảng/enum nào trùng tên `SystemSetting`** trong `schema.prisma`.
- **Không có route nào đang chiếm `admin/system-settings`**; convention `admin/...` đã có tiền lệ ở
  `user.controller.ts` (`admin/users`) và `admin-entitlement.controller.ts` (`admin/entitlements`).
- **`createZodDto` của `nestjs-zod`** là dạng DTO chuẩn trong repo (xem `studio-release.dto.ts`),
  không cần quyết định thêm.
- **Ba biến ở lại `.env`** (`SEPAY_WEBHOOK_API_KEY`, `SEPAY_API_TOKEN`,
  `SEPAY_RECONCILE_INTERVAL_MINUTES`) hiện khai báo `optional()`, nên việc giữ nguyên chúng không
  đụng gì tới thay đổi lần này.
