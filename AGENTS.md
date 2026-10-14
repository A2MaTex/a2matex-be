# A2MaTeX Backend Agent Instructions

This repository is a NestJS 11 modular monolith using Prisma 7, PostgreSQL, Redis, Zod, and TypeScript in NodeNext mode.

Before changing code, read [`.codex/00_INDEX.md`](.codex/00_INDEX.md) and the task-specific notes it routes to. These files document the current architecture and repository-specific conventions; they override generic framework advice.

Always response with `AGENTS.md loaded` to ensure that you have loaded this file on your session.

## Required working style

- Do not implement the code immediately. After receiving the requirements, you must first inspect the relevant planning document and the current implementation before proposing changes. Only implement after receiving explicit user approval.
- For non-trivial work, explain the intended scope, files, migration impact, and validation plan, then wait for explicit user approval before editing.
- Keep diffs small and preserve unrelated tracked or untracked work.
- Follow existing module, DTO, repository, error, transaction, cache, and logging patterns before adding abstractions.
- Do not add dependencies, edit secrets or `.env` files, or change generated files manually without explaining why and receiving approval.
- Ask whether tests are wanted when the requested behavior does not already require them. By default, tests are not required when implementing a new feature.
- After implementation, report files changed, checks actually run, checks not run, and remaining risks. Never describe static inspection as runtime or database validation.

## Hard repository rules

- Use the SQL-first Prisma workflow in [`.codex/04_DATABASE_PRISMA.md`](.codex/04_DATABASE_PRISMA.md). Do not begin by hand-editing `prisma/schema.prisma`.
- You are only allowed to create the migration, the command `npx prisma migrate dev --create-only --config prisma7.config.ts` is allowed, but apply the migration or deploy the migration is strictly forbidden, only the user has the right to do that.
- Repositories participating in `@Transactional()` must resolve `prismaService.getClient()` at call time through a getter.
- Redis locks use opaque owner UUIDs and owner-safe compare-and-delete release. Do not replace them with a boolean lock.
- The API prefix comes from `API_PREFIX`; never hard-code `/api/v1` in route, permission, or deployment logic.
- Successful responses are globally wrapped as `{ data, statusCode }`; service methods return the inner payload.
- Follow the established mutation response convention unless an approved feature contract explicitly requires otherwise: create endpoints return only `{ id }`; update, delete, archive, activation, and status-transition endpoints return `SUCCESS_RESPONSE` through `MessageResDTO`; read endpoints return resource DTOs.
- Select and return only the fields required by the endpoint response contract. Do not return a complete database record from a mutation merely because Prisma provides it.
- Prefer Prisma ORM and reuse one typed `where` object for related count/data queries. Use raw SQL only when an approved requirement cannot be expressed safely through Prisma, and document the reason.
- Protected routes are the default. Use `@IsPublic()` only for deliberately anonymous endpoints.
- Treat access-token role data as a current architectural limitation: a token carries one role even though users may have multiple `UserRole` rows. Business policies requiring multiple roles must query current database state.
- Do not log credentials, access or refresh tokens, passwords, OTPs, private payloads, or secrets.
- Do not add routine success logs for ordinary CRUD operations. Rely on centralized request/error logging for failures; add domain success logs only when an approved operational or audit requirement needs them.

## Instruction map

- [`.codex/01_ARCHITECTURE.md`](.codex/01_ARCHITECTURE.md): system and backend boundaries
- [`.codex/02_NESTJS_CONVENTIONS.md`](.codex/02_NESTJS_CONVENTIONS.md): module structure and clean-code conventions
- [`.codex/03_SHARED_INFRASTRUCTURE.md`](.codex/03_SHARED_INFRASTRUCTURE.md): guards, decorators, middleware, filters, transactions, cache, and utilities
- [`.codex/04_DATABASE_PRISMA.md`](.codex/04_DATABASE_PRISMA.md): database conventions and migration workflow
- [`.codex/05_WORKFLOW_AND_VALIDATION.md`](.codex/05_WORKFLOW_AND_VALIDATION.md): safe implementation and verification process
- [`.codex/06_REFERENCES.md`](.codex/06_REFERENCES.md): source-of-truth document and code references
