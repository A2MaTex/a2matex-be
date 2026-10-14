# Phase 2 — Cloud Project Module

This implementation phase corresponds to **Phase 5 — Project database and module** in
`studio_workflow_checklist.md`.

The goal is to create the Publisher-owned cloud container used by Studio. This phase does not store
the workflow graph yet; `ProjectDraft` belongs to the next phase.

**Status:** Implemented, migrated, permissioned, and production-equivalent CRUD smoke-tested.
Multi-user Customer, blocked-Publisher, cross-Publisher, and soft-delete isolation checks remain
open until dedicated local test accounts/fixtures are approved.

## 1. Confirm the Project contract

- [x] Confirm `ProjectStatus` contains only:
  - [x] `ACTIVE`
  - [x] `ARCHIVED`
- [x] Confirm a Project is owned by exactly one `PublisherAccount`.
- [x] Confirm only an `ACTIVE`, non-deleted Publisher account can create a Project.
- [x] Confirm blocking a Publisher removes the Publisher role but preserves the non-deleted
      `PublisherAccount` as the ownership anchor.
- [x] Confirm a blocked former Publisher retains read-only `OWN` access through the Customer role.
- [x] Confirm `UserStatus.BANNED`, not `PublisherAccountStatus.BLOCKED`, denies all authenticated
      access.
- [x] Confirm Project names are unique per Publisher account after trimming and case folding.
- [x] Set Project name rules:
  - [x] Trim surrounding whitespace.
  - [x] Minimum length: 1 character.
  - [x] Maximum length: 255 characters.
  - [x] Reserve names across both active and archived Projects.
- [x] Set Project description rules:
  - [x] Optional and nullable.
  - [x] Trim surrounding whitespace when provided.
  - [x] Maximum length: 4,000 characters.
  - [x] Store an empty trimmed description as `NULL`.
- [x] Confirm archive behavior:
  - [x] Archiving changes `ACTIVE` to `ARCHIVED`.
  - [x] Archiving an already archived accessible Project is idempotent and returns the standard
        success response.
  - [x] Archived Projects remain readable.
  - [x] Archived Projects cannot be renamed or otherwise modified.
  - [x] Unarchive is not included in the MVP.
- [x] Confirm there is no public Project delete endpoint in this phase.
- [x] Confirm ordinary Project operations do not use a Redis distributed lock.
- [x] Confirm create derives ownership from the authenticated user and requires an active,
      non-deleted Publisher account. `OWN` update/archive has the same Publisher requirement, while
      unrestricted Admin update/archive bypasses owner Publisher status but still obeys Project
      lifecycle rules.

### Contract gate

- [x] Backend and Studio agree on the Project fields and status behavior.
- [x] Use stable errors:
  - [x] Missing or cross-owner Project: `404 Error.ProjectNotFound`.
  - [x] Metadata mutation of an archived Project: `409 Error.ProjectArchived`.
  - [x] Rename to another Project's normalized name: `409 Error.ProjectNameAlreadyExists`.
  - [x] Invalid input: `422` through the global Zod validation pipe.
  - [x] Missing route permission: `403` through `AccessTokenGuard`.

---

## 2. SQL-first Project migration

Create a forward-only migration containing:

- [x] `ProjectStatus` PostgreSQL enum.
- [x] `Project` table with:
  - [x] `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
  - [x] `publisherAccountId UUID NOT NULL`.
  - [x] `name VARCHAR(255) NOT NULL`.
  - [x] `description TEXT NULL`.
  - [x] `status ProjectStatus NOT NULL DEFAULT ACTIVE`.
  - [x] `createdById UUID NOT NULL`.
  - [x] `updatedById UUID NULL`.
  - [x] `deletedById UUID NULL`.
  - [x] `createdAt TIMESTAMPTZ NOT NULL DEFAULT now()`.
  - [x] `updatedAt TIMESTAMPTZ NULL`.
  - [x] `deletedAt TIMESTAMPTZ NULL`.
- [x] Keep name trimming/non-blank validation and description normalization/length validation in
      the strict Zod API contracts; do not add database check constraints for them in this phase.
- [x] Foreign key from `publisherAccountId` to `PublisherAccount.id`.
- [x] Foreign key from `createdById` to `User.id`.
- [x] Foreign key from `updatedById` to `User.id`.
- [x] Foreign key from `deletedById` to `User.id`.
- [x] Use deliberate `NO ACTION` foreign-key deletion behavior.
- [x] Add partial index for active ownership queries:

```sql
CREATE INDEX "Project_publisherAccountId_status_idx"
ON "Project" ("publisherAccountId", status)
WHERE "deletedAt" IS NULL;
```

- [ ] Add the case-insensitive Publisher/name unique index in the Project Draft forward migration
      after checking existing rows for normalized duplicates.

- [x] Confirm no additional detail index is needed because the UUID primary-key lookup occurs first.
- [x] Do not add `ProjectDraft`, graph JSON, Runtime IR, assets, revisions, or submissions.

### Migration gate

- [x] Review the final SQL migration after restoring the ownership/status index.
- [x] Stop before applying the migration.
- [x] User applies the migration.
- [x] Run `prisma db pull` only after successful deployment.
- [x] Generate the Prisma client.
- [x] Review generated `Project`, `PublisherAccount`, and `User` relationships.
- [x] Run the Backend build.

---

## 3. Project API contracts

Define strict Zod contracts for:

- [x] Project ID route parameter.
- [x] Create Project request.
- [x] Create Project response.
- [x] Project list query.
- [x] Project list item.
- [x] Project detail response.
- [x] Update Project metadata request.
- [x] Standard update and archive success responses.

### Proposed routes

- [x] `POST /projects` — create a Project.
  - [x] Return only the created Project `id`, following the existing create-response convention.
- [x] `GET /projects` — list Projects allowed by the active permission scope.
- [x] `GET /projects/:projectId` — get a Project allowed by the active permission scope.
- [x] `PUT /projects/:projectId` — rename or update description.
  - [x] Return the standard success message.
- [x] `PUT /projects/:projectId/archive` — archive an active Project.
  - [x] Return the standard success message, including an idempotent repeat.

### List behavior

- [x] Use the existing pagination contract.
- [x] Return all Project statuses when the `status` filter is omitted.
- [x] Accept optional `status=ACTIVE|ARCHIVED` to select one status.
- [x] Sort by `updatedAt DESC NULLS LAST, createdAt DESC, id DESC` using Prisma ORM.
- [x] Never return soft-deleted Projects.
- [x] For `OWN`, return only Projects owned by the caller's active or blocked, non-deleted
      Publisher account.
- [x] For unrestricted `null` scope, return all matching non-deleted Projects without resolving a
      Publisher account.

### Response boundaries

- [x] Return Project identifiers, `publisherAccountId`, metadata, status, and timestamps from read
      endpoints.
- [x] Return `{ id }` from create and the standard success message from update/archive.
- [x] Do not return internal deletion fields.
- [x] Do not return workflow graph, Runtime data, or publication data.
- [x] Use the global `{ data, statusCode }` response envelope.

---

## 4. Repository implementation

- [x] Add `ProjectRepo` following existing Prisma repository patterns.
- [x] Accept a typed Project access predicate from the service; do not inspect roles or raw
      permission records in the repository.
- [x] For `OWN`, resolve the caller's non-deleted Publisher account once without requiring `ACTIVE`
      for reads.
- [x] For unrestricted access, do not query the caller's Publisher account.
- [x] Create a Project with Publisher ownership and audit-user fields.
- [x] List non-deleted Projects using the resolved access predicate.
- [x] For `OWN`, detail/update/archive queries include `publisherAccountId`; unrestricted queries do
      not.
- [x] Restrict metadata updates to `ACTIVE` Projects.
- [x] Archive using an atomic conditional update from `ACTIVE` to `ARCHIVED`.
- [x] Distinguish not-found, cross-owner, archived, and stale-status outcomes without exposing another
      Publisher's Project existence.
- [x] Set `updatedById` and `updatedAt` on mutations.
- [x] Do not perform database operations inside loops.

---

## 5. Domain service rules

- [x] Add `ProjectService`.
- [x] Resolve permission scopes with this precedence: unrestricted `null` wins over `OWN`; no scope
      is denied.
- [x] Resolve a non-deleted Publisher account for `OWN` reads even when its status is `BLOCKED`.
- [x] Derive create ownership from the authenticated user and require an `ACTIVE`, non-deleted
      Publisher account.
- [x] Require an `ACTIVE`, non-deleted Publisher account for `OWN` mutations.
- [x] Reject Project creation for:
  - [x] A normal Customer without a Publisher account.
  - [x] A blocked Publisher.
  - [x] A deleted Publisher account.
- [x] Enforce ownership for `OWN` reads and mutations; Admin unrestricted access bypasses the owner
      predicate and owner Publisher status, but not Project lifecycle rules.
- [x] Treat cross-Publisher `OWN` access as not found to avoid resource enumeration.
- [x] Reject metadata changes to archived Projects.
- [x] Implement the agreed repeated-archive behavior.
- [x] Normalize names and descriptions at the API boundary.
- [x] Return stable domain errors suitable for Studio.
- [x] Do not add routine create, update, or archive success logs; rely on centralized request/error
      logging for failures.
- [x] Do not log descriptions, future workflow graphs, credentials, or private inputs.

---

## 6. Controller and module

- [x] Add `ProjectController`.
- [x] Add `ProjectModule`.
- [x] Register the module in `AppModule`.
- [x] Keep all Project routes Bearer-protected.
- [x] Read the authenticated user ID with `@ActiveUser('userId')`; read route scopes only for
      existing-resource operations that need ownership filtering.
- [x] Pass only the current route's resolved scopes into scoped Project service operations; do not
      couple Project code to role names, Redis cache values, or `@ActiveRolePermissions()`.
- [x] Use explicit Zod DTOs where query or parameter validation depends on runtime metadata and the
      global Zod pipe.
- [x] Add OpenAPI tags and response contracts.
- [x] Follow existing controller naming, injection, and response patterns.

---

## 7. Permissions and Publisher-role lifecycle

- [x] Create Project route permissions through `POST /api/v1/permissions`.
- [x] Do not run the permission seed because it may alter existing role assignments.
- [x] Assign `GET /projects` and `GET /projects/:projectId` with `OWN` scope to Customer and
      Publisher roles.
- [x] Assign the unscoped create permission only to the Publisher role.
- [x] Assign update/archive permissions with `OWN` scope only to the Publisher role.
- [x] Assign list/detail/update/archive permissions with unrestricted `null` scope to Admin.
- [x] Do not give Admin-only users create-on-behalf behavior in this phase.
- [x] Append permission IDs to each role's current permission IDs without removing existing IDs.
- [x] On Publisher block, soft-delete that user's Publisher `UserRole` in the same transaction while
      retaining the Customer role and `PublisherAccount`.
- [x] On Publisher reactivation, restore the Publisher role using the existing role restoration
      path.
- [x] Do not clear permission caches for membership changes; the guard reads active role IDs from
      PostgreSQL on every request.

---

## 8. Verification

### Contract and service checks

- [x] Valid Project input is accepted.
- [x] Blank or oversized names are rejected by the compiled production-equivalent server.
- [x] Invalid UUID route parameters are rejected before the service runs by the compiled
      production-equivalent server.
- [x] Active Publisher can create a Project.
- [ ] Customer without a Publisher account gets an empty owned list and cannot create a Project.
- [ ] Blocked former Publisher can list and read only their own Projects.
- [ ] Blocked former Publisher cannot create, update, archive, save drafts, or submit.
- [ ] Publisher sees only their own Projects.
- [ ] Admin can list, read, update, and archive any Project without a Publisher-account lookup.
- [x] A user with Admin and Publisher roles receives unrestricted access for routes granted by both.
- [ ] One Publisher cannot read or modify another Publisher's Project.
- [x] Archived Project remains readable.
- [x] Archived Project cannot be renamed.
- [x] Repeated archive follows the agreed behavior.
- [ ] Soft-deleted Projects never appear in normal reads.

### Database verification

- [x] Confirm the migration is deployed before claiming database success.
- [x] Confirm foreign keys and indexes exist.
- [x] Confirm audit fields are written correctly.
- [x] Confirm the archive update is atomic.

### HTTP smoke test

- [x] Missing token returns `401`.
- [ ] Authenticated role without permission returns `403`.
- [x] Active Publisher creates a Project successfully.
- [x] Publisher list contains the new Project.
- [x] Detail returns the Project.
- [x] Metadata update succeeds while active.
- [x] Archive succeeds.
- [x] Metadata update after archive is rejected.
- [ ] Another Publisher cannot access the Project.
- [ ] After Publisher blocking, the same user can still list/read the Project but receives `403` for
      Publisher-only mutation routes.
- [ ] Admin can access the Project regardless of its owner's Publisher status.

### Static checks

- [x] Run focused checks agreed for this phase.
- [x] Run `npm run build`.
- [x] Run `npm run lint`.
- [x] Run Prettier on changed source files.
- [x] Run `git diff --check`.
- [x] Report existing unrelated warnings separately.

---

## 9. Phase completion criteria

- [x] The Project migration has been applied by the user and introspected successfully.
- [ ] Active Publishers can create, list, read, update, and archive only their own Projects.
- [ ] Blocked former Publishers retain Customer `OWN` read access but no Publisher mutation
      capability.
- [ ] Admin can list, read, update, and archive across ownership boundaries.
- [x] Archived Projects are readable but immutable.
- [ ] Customer, blocked Publisher, cross-owner, and soft-delete rules are enforced.
- [x] Permissions are created and assigned without disturbing existing role assignments.
- [x] Logs contain identifiers and state changes but no private Project or workflow payloads.
- [x] Backend build and lint complete with no new errors.
- [x] `studio_workflow_checklist.md` is updated before starting the Project Draft phase.

### Remaining verification boundary

- The compiled server (`npm run start:prod`) passed the checked HTTP cases above.
- `npm run start` and `npm run start:dev` use `tsx`, which does not emit the decorator metadata
  required by implicit global DTO validation. Do not use those commands as validation proof until
  the development launcher is corrected.
- Customer-only, second-Publisher, blocked-Publisher, cross-owner, and soft-delete behavior remain
  unchecked because the current local database has no approved dedicated credentials/fixtures for
  those scenarios.

## Deferred to the next phase

- `ProjectDraft` persistence.
- Editor Graph and Runtime IR JSON.
- Optimistic draft versioning.
- Draft validation summaries and test summaries.
- Graph validation and parameter bindings.
- Assets and screenshots.
- Workflow revisions and submission.
- Runtime execution history.
