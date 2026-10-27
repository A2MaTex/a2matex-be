# Data Model: Tách job định kỳ ra dịch vụ riêng

**Input**: `spec.md` Key Entities + `research.md` §2, §3

Tính năng **không đổi schema Prisma, không migration**. Hai thực thể trong spec chỉ tồn
tại trong bộ nhớ của dịch vụ job và trong nhật ký.

## CronJobDefinition (interface, `src/cron/cron-job.interface.ts`)

Một job định kỳ. Mỗi job là một `@Injectable()` class implement interface này và được
gom vào multi-provider `CRON_JOBS` trong `src/cron/cron.module.ts` (danh sách duy nhất —
FR-012).

| Trường | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `name` | `string` | duy nhất trong `CRON_JOBS`, kebab-case | khoá trong `SchedulerRegistry` và trong log; trùng → runner từ chối khởi động |
| `envKey` | `string` | tên biến môi trường, dạng `CRON_<JOB>` | chỉ dùng để thông báo lỗi và log nguồn lịch (FR-007, FR-009) |
| `schedule` | `string` | biểu thức cron 5 trường hợp lệ theo `cron` 4, hoặc đúng chuỗi `off` | đã resolve từ env hoặc mặc định; kiểm tra bằng `validateCronExpression` lúc bootstrap |
| `scheduleSource` | `'env' \| 'default'` | | log lúc khởi động để người vận hành biết lịch đến từ đâu |
| `run()` | `() => Promise<void>` | PHẢI idempotent (FR-014) | runner bắt mọi lỗi ném ra; job không cần tự try/catch toàn bộ, chỉ cần tự cô lập lỗi từng phần tử nếu xử lý theo lô |

Helper `resolveCronSchedule(override, fallback)` trả `{ schedule, scheduleSource }`:
`override` có giá trị → `('env', override)`; trống → `('default', fallback)`. Giá trị
`off` (không phân biệt hoa thường, sau `trim`) được chuẩn hoá thành
`CRON_SCHEDULE_OFF = 'off'`. `envKey` là thuộc tính tĩnh của job, không đi qua helper.

### Job hiện có

| `name` | `envKey` | Lịch mặc định | `run()` |
|---|---|---|---|
| `topup-reconcile` | `CRON_TOPUP_RECONCILE` | `*/${SEPAY_RECONCILE_INTERVAL_MINUTES} * * * *` | `SepayApiClient.listRecentTransactions(minutes)` rồi `TopUpService.handleIncomingTransaction` từng giao dịch, lỗi một giao dịch không chặn giao dịch sau (giữ nguyên `topup.cron.ts`) |

Job dọn dẹp upload presigned sẽ được thêm theo spec riêng, cùng bảng này.

## Trạng thái runner (`CronRunner`, trong bộ nhớ)

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `inFlight` | `Map<name, Promise<void>>` | lần chạy đang dở của từng job; có khoá → tick mới bị bỏ qua (FR-011); dùng để drain khi shutdown (FR-017) |
| `SchedulerRegistry` (của `@nestjs/schedule`) | `Map<name, CronJob>` | job đã đăng ký và đang chạy; job `off` không có trong đây |

## Job Run (chỉ trong nhật ký, không lưu DB)

Mỗi lần `execute(job)` sinh các dòng log với context `CronRunner`:

| Sự kiện | Mức | Nội dung tối thiểu |
|---|---|---|
| khởi động | log | `name`, `schedule`, `scheduleSource` (`env`/`default`), `nextRun` ISO |
| tắt | log | `name`, `envKey`, "disabled" |
| bắt đầu | log | `name`, thời điểm |
| kết thúc thành công | log | `name`, `durationMs` |
| kết thúc lỗi | error | `name`, `durationMs`, message + stack |
| bỏ qua vì đang chạy dở | warn | `name`, "previous run still in progress" |
| shutdown | log/warn | số job đang dở, đã chờ bao lâu, có quá ân hạn hay không |

Kết quả (`outcome`) nhận một trong ba giá trị: `success`, `error`, `skipped`.

## Vòng đời dịch vụ job

```
bootstrap ──► validate + register (onApplicationBootstrap) ──► listen CRON_PORT ──► ticks...
   │                      │
   │ lỗi config/validate  │ SIGTERM / SIGINT
   ▼                      ▼
 exit 1          beforeApplicationShutdown: stop() mọi CronJob → chờ inFlight
                 (≤ CRON_SHUTDOWN_GRACE_SECONDS) → app.close() → exit 0
```
