<!--
Sync Impact Report
Version change: [TEMPLATE] → 1.0.0 (initial ratification)
Modified principles: n/a (first adoption, no prior ratified version)
Added sections:
  - Core Principles I–VI (Schema-Validated Boundaries, Permission-Gated Routes,
    Migration Discipline, Quality Gates Before Deploy, Explicit Decision Gates
    for Infrastructure, Simplicity / YAGNI)
  - Security & Secrets
  - Development Workflow
  - Governance
Removed sections: none (replaced bracket placeholders only)
Deferred TODOs: none — all placeholders resolved from repo evidence
    (README.md, package.json, docs/deployment-spec.md, docs/deployment-runbook.md,
    .github/workflows/deploy.yml, src/shared/config.ts, recent commit history,
    specs/001-vps-deployment/spec.md). Nothing in this constitution has been
    pushed yet, so earlier 1.0.0 / 1.0.1 / 1.1.0 drafts from this same session
    were squashed into this single initial ratification rather than kept as
    amendment history.
Templates requiring follow-up: none checked in this pass — re-validate
    .specify/templates/plan-template.md and tasks-template.md against Principle
    II (permission seeding) and III (migration discipline) next time either
    template is touched.
-->

# a2matex-be Constitution

## Core Principles

### I. Ranh giới được xác thực bằng Zod (Schema-Validated Boundaries)

Mọi dữ liệu đến từ bên ngoài — biến môi trường, request body/query/param — PHẢI đi qua
một Zod schema trước khi chạm vào business logic. Config đọc qua `configSchema` trong
`src/shared/config.ts`; DTO request/response dùng `nestjs-zod`. App PHẢI từ chối khởi
động nếu thiếu biến môi trường bắt buộc, không được fallback âm thầm sang giá trị đoán.
Secret (`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`) PHẢI tối thiểu 32 ký tự và khác
nhau.

**Lý do**: đây là cơ chế duy nhất chặn sai lệch cấu hình trước khi nó gây lỗi ở
production; `docs/deployment-spec.md` liệt kê cấu hình sai là rủi ro đã biết hàng đầu.

### II. Route nào, Permission nào (Permission-Gated Routes)

Mọi route mới — trừ route health-check công khai — PHẢI nằm sau `AccessTokenGuard` và
có một permission record tương ứng. PR thêm route mới PHẢI gồm cả thay đổi seed
permission (`src/seed/create-permissions.ts`) trong cùng PR, không tách làm sau. Sau khi
seed permission thay đổi, cache role-permission PHẢI được invalidate.

**Lý do**: guard so khớp request với bảng `Permission` trong DB; thiếu seed thì route
trả 403 cho tất cả, kể cả admin (`specs/001-vps-deployment/spec.md` FR-010, trước đó là
`docs/deployment-spec.md` §5 mục 3). Cache permission không được clear sau seed từng là
bug thật đã xảy ra (commit `f03ea8a`).

### III. Migration đi trước, App theo sau (Migration Discipline)

Mọi thay đổi `schema.prisma` PHẢI đi kèm migration file commit cùng PR, tạo bằng
`prisma migrate dev --create-only`. Migration PHẢI áp dụng sạch được trên database rỗng
trước khi merge. Thứ tự bắt buộc khi deploy: chạy `prisma migrate deploy` xong rồi mới
thay container app — không bao giờ ngược lại. Không sửa dữ liệu hay schema production
bằng tay ngoài quy trình migration.

**Lý do**: migration lỗi (dấu phẩy dư, thứ tự sai) đã từng chặn deploy (commit `fe2b894`,
`d03357f`); runbook có hẳn mục "failed-migration recovery" vì sự cố này tốn chi phí thật.

### IV. Cổng chất lượng trước khi deploy (Quality Gates Before Deploy)

`npm run lint` (oxlint, type-aware), `npm test` (vitest) và build PHẢI pass trước khi
image được build và đẩy lên GHCR. Không dùng `--no-verify` hay bỏ qua hook để qua cổng
này. Image PHẢI gắn tag theo commit SHA, không chỉ `latest`, để rollback là trỏ lại tag
cũ, không cần build lại.

**Lý do**: đã mã hoá trong `.github/workflows/deploy.yml`; đây là FR-001/FR-002 của
`specs/001-vps-deployment/spec.md` — hỏng thì dừng, không đẩy image.

### V. Quyết định hạ tầng là quyết định rõ ràng (Explicit Decision Gates for Infrastructure)

Thay đổi về hạ tầng, reverse proxy, hosting, CI/CD PHẢI được viết thành spec bằng
`/speckit-specify`, theo template chung của spec-kit (`specs/<số>-<tên>/spec.md`) — không
còn dùng tài liệu tự do trong `docs/` cho việc này. Lựa chọn chưa chốt PHẢI đứng dưới dạng
`[NEEDS CLARIFICATION]` hoặc trong mục Assumptions, và chỉ coi là "đã chốt" khi người
quyết định (chủ repo) xác nhận trực tiếp. Không tự chọn thay khi quyết định chưa chốt —
kể cả khi có một lựa chọn rõ ràng hợp lý hơn.

**Lý do**: một template chung giúp mọi quyết định hạ tầng dễ tìm lại và dễ đối chiếu với
plan/tasks về sau, thay vì mỗi tài liệu tự do một kiểu. `specs/001-vps-deployment/spec.md`
là spec đầu tiên theo quy ước này, thay cho `docs/deployment-spec.md` (giữ lại làm tài
liệu lịch sử, không còn là nguồn chốt quyết định).

### VI. Đơn giản, không trừu tượng hoá sớm (Simplicity / YAGNI)

Không thêm abstraction, feature flag, hay lớp tương thích ngược cho nhu cầu giả định.
Sửa trực tiếp thay vì bọc thêm lớp "phòng khi cần". Dependency mới PHẢI có lý do cụ thể
cho tính năng đang làm, không thêm vì "có thể hữu ích sau này".

**Lý do**: giữ codebase dễ đọc ở quy mô hiện tại (NestJS module hoá theo `src/routes/`);
ba dòng lặp lại vẫn tốt hơn một abstraction sớm và sai.

## Security & Secrets

- Secret (JWT, DB password, API key) không commit vào repo; chỉ `.env.example` và
  `.env.production.example` được commit, `.env` thật nằm trong `.gitignore`.
- Khóa SSH dùng để CI deploy lên VPS PHẢI là khóa riêng chỉ dùng cho việc đó, không dùng
  khóa cá nhân của bất kỳ ai (`docs/deployment-runbook.md`).
- `CORS_ORIGIN` chỉ bật `credentials: true` khi có danh sách domain cụ thể; không để mở
  `*` kèm credentials.
- Khi review PR, bất kỳ file nào trông như chứa secret (tên file không rõ ràng cũng
  phải kiểm tra nội dung) PHẢI được xác minh trước khi stage/commit.

## Development Workflow

- Dev cục bộ theo đúng thứ tự trong `README.md`: `npm install` → `cp .env.example .env`
  → `npm run compose-up` → `npm run prisma:generate` → `npm run prisma:migrate:deploy`
  → `npm run seed:roles` → `npm run seed:permissions` → `npm run start:dev`.
- Module mới dùng `nest g module/controller/service routes/<name> --no-spec`, theo quy
  ước README; không tạo cấu trúc route tùy ý khác.
- Format bằng Prettier (`singleQuote`, `trailingComma: all`, `printWidth: 100`); lint
  bằng oxlint type-aware (`typescript/no-floating-promises` bắt buộc là lỗi). Cả hai
  PHẢI pass trước khi mở PR, không chỉ trước khi merge.
- Deploy tự động khi merge vào nhánh `staging` — hiện tại nhánh này đóng vai trò channel
  production thật (chưa có môi trường staging riêng), theo đúng FR-001 của
  `specs/001-vps-deployment/spec.md`. Tách nhánh `production` riêng đã ghi trong mục Out
  of Scope của spec đó như việc sẽ làm sau; khi làm, phải viết spec mới qua
  `/speckit-specify` theo Nguyên tắc V, không sửa trực tiếp `deploy.yml` mà bỏ qua spec.

## Governance

Constitution này có vị trí cao hơn mọi quy ước không chính thức khác trong repo. Khi một
thực hành thường làm mâu thuẫn với constitution, constitution PHẢI được sửa trước (qua
`/speckit-constitution`), không lặng lẽ làm khác đi.

**Sửa đổi**: mọi thay đổi phải đi kèm Sync Impact Report (như khối comment ở đầu file
này) và tăng version theo semver:
- MAJOR: bỏ hoặc đổi một nguyên tắc theo cách không tương thích ngược.
- MINOR: thêm nguyên tắc mới hoặc mở rộng đáng kể một nguyên tắc có sẵn.
- PATCH: làm rõ câu chữ, sửa lỗi chính tả, không đổi ý nghĩa.

**Tuân thủ**: khi chạy `/speckit-plan` hoặc review PR, đối chiếu với các nguyên tắc ở
đây. Vi phạm có lý do chính đáng PHẢI được ghi lại rõ ràng (ví dụ trong mục Complexity
Tracking của plan hoặc trong PR description) thay vì âm thầm bỏ qua.

**Version**: 1.0.0 | **Ratified**: 2026-10-08 | **Last Amended**: 2026-10-08
