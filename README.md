# a2matex-be

Backend API cho A2MaTeX: NestJS 11, Prisma 7 (PostgreSQL), Redis, Zod.

## Tài liệu triển khai

| Tài liệu                                                 | Dùng khi                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [docs/deployment-spec.md](docs/deployment-spec.md)       | muốn hiểu kiến trúc, quyết định và những gì đã kiểm chứng                          |
| [docs/deployment-runbook.md](docs/deployment-runbook.md) | cần thao tác thật trên VPS và GitHub: thiết lập lần đầu, deploy, quay lui, sao lưu |

Deploy là tự động: merge vào `staging` sẽ build image, đẩy lên GHCR và cập nhật VPS qua workflow `.github/workflows/deploy.yml`.

Tài liệu API (Swagger UI) nằm tại `/api/v1/docs` trên mọi môi trường, bản JSON tại `/api/v1/docs-json`.

## Phát triển cục bộ

```bash
npm install
cp .env.example .env            # rồi điền giá trị
npm run compose-up              # postgres + redis
npm run prisma:generate
npm run prisma:migrate:deploy
npm run seed:roles
npm run seed:permissions
npm run start:dev
```

## Tools

### Docker

Start the docker container with predefined env

```bash
docker compose --env-file .env -f tools/docker-compose.yaml up -d
```

## Prisma

### Migration steps

1. Create migration file with prisma

```bash
npx prisma migrate dev --create-only --config prisma7.config.ts
```

2. Apply migration to the database

```bash
npx prisma migrate deploy --config prisma7.config.ts
```

3. Update schema.prisma from the actual DB

```bash
npx prisma db pull --config prisma7.config.ts
```

4. Generate Prisma Client

```bash
npx prisma generate --config prisma7.config.ts
```

5. Other

Verify the checksum of modified migration

```bash
sha256sum prisma/migrations/20261005015649_add_static_storage/migration.sql
```

## NestJS

### Start a new module

Generate core files

```bash
npx nest g module routes/<module_name> --no-spec
npx nest g controller routes/<module_name> --no-spec
npx nest g service routes/<module_name> --no-spec
```

Flags meaning

```bash
--dry-run       # show what the command would do
--no-spec       # do not create .spec.ts files
--spec          # force spec files
--flat          # generate without nested folder
--no-flat       # generate folder structure
--skip-import   # do not auto-import into module
--format        # run prettier on generated files
```

## Seed initial data

### Create roles

```bash
npx tsx src/seed/create-role.ts
```

### Create permissions

```bash
npx tsx src/seed/create-permissions.ts
```
