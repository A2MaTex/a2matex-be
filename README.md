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
