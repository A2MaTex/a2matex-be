# Phase 3 — Mutable Project Draft

This implementation phase corresponds to **Phase 6 — Mutable Project Draft** in
`studio_workflow_checklist.md` and is governed by
`../a2matex-plan/components/a2matex-backend/studio_project_workflow/project_draft.md`.

The goal is to persist the latest Studio-authored workflow snapshot with optimistic concurrency.
This phase stores draft content but does not implement graph semantics, finalization, submission,
assets, credentials, or Runtime execution history.

**Status: Backend phase complete.** Migration, permissions, compiled HTTP behavior, ownership,
blocked-Publisher behavior, retry safety, and real PostgreSQL concurrency were verified on
2026-10-15. Studio conflict-tab UX remains a later client integration task.

## 1. Freeze the draft contract

- [x] Confirm each Project has at most one current `ProjectDraft` row.
- [x] Confirm Studio creates a local Project first and creates the cloud Project only on the first
      explicit Save to Cloud.
- [x] Treat the cloud Project and draft as the source of truth for synchronized state; another
      device downloads them instead of linking an unrelated local Project.
- [x] Make cloud Project creation retry-safe through case-insensitive uniqueness on normalized
      Project name plus Publisher account; do not accept a client-generated identity as authority.
- [x] Create the row lazily on the first save; do not create an empty draft with every Project.
- [x] Use `expectedVersion = 0` only for first creation.
- [x] Use the current positive version for later saves.
- [x] Return `200` with `{ draft: null }` when an accessible Project has no draft.
- [x] Keep archived Projects and their drafts readable but reject draft saves.
- [x] Include `projectStatus` in the Draft read response so Studio can immediately enter read-only
      mode; still enforce status again on every save.
- [x] Allow Customer/Publisher `OWN` reads and Admin unrestricted reads.
- [x] Allow saves only through Publisher `OWN`; Admin does not edit Publisher workflow content in
      the MVP.
- [x] Define a maximum serialized draft-content size of 1 MiB (`1_048_576` bytes).
- [x] Backend implementation owns the automated-test scope, including idempotency, hashing,
      optimistic concurrency, authorization, archive behavior, and payload limits.

## 2. SQL-first migration

- [x] Create a forward-only migration with one `ProjectDraft` per Project.
- [x] Add a unique expression index on `Project(publisherAccountId, lower(btrim(name)))`; fail with
      an actionable error if existing normalized duplicates prevent deployment.
- [x] Add:
  - [x] `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
  - [x] `projectId UUID NOT NULL UNIQUE` referencing `Project.id` with `NO ACTION`.
  - [x] `version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)`.
  - [x] `editorGraph JSONB NOT NULL`.
  - [x] `inputSchema JSONB NOT NULL`.
  - [x] `runtimeIr JSONB NULL`.
  - [x] `validationSummary JSONB NOT NULL DEFAULT '{}'::JSONB`.
  - [x] `testSummary JSONB NOT NULL DEFAULT '{}'::JSONB`.
  - [x] `contentHash VARCHAR(64) NOT NULL` with lowercase SHA-256 check.
  - [x] `savedAt TIMESTAMPTZ NOT NULL DEFAULT now()`.
  - [x] `savedById UUID NOT NULL` referencing `User.id` with `NO ACTION`.
- [x] Add database constraints requiring every non-null JSON field to be an object.
- [x] Keep standard row lifecycle timestamps, but add no draft-delete API, draft history, assets,
      credentials, or execution records.
- [x] Review the migration and stop for user deployment.
- [x] After user deployment, run `prisma db pull`, generate the client, and review relations.

## 3. API contracts

- [x] Add strict Zod contracts for:
  - [x] Project ID route parameter.
  - [x] Draft read response.
  - [x] Draft save request and compact synchronization response.
  - [x] Non-negative safe-integer `expectedVersion`.
  - [x] Object-only draft fields and nullable object `runtimeIr`.
- [x] Add `GET /projects/:projectId/draft`.
- [x] Add `PUT /projects/:projectId/draft`.
- [x] Return `projectStatus` and the nullable draft from `GET`; a present draft contains the five
      content fields plus `id`, `projectId`, `version`, `contentHash`, and `savedAt`, while
      `savedById` remains internal.
- [x] Return only `id`, `version`, `contentHash`, and `savedAt` from `PUT`; this is an explicit
      exception to the standard mutation success response because Studio needs the authoritative
      version for its next save.
- [x] Never accept `contentHash`, version, save time, or saving user from Studio.
- [x] Reject a body whose serialized draft-content fields exceed 1 MiB with stable `413` behavior.
- [x] Raise the named global JSON transport ceiling to 2 MiB so the feature can apply the exact
      1 MiB canonical-content limit; do not leave Express's lower default as the effective limit.
- [x] Keep validation/test summaries informational; they cannot authorize finalization.

## 4. Canonical content hash

- [x] Add a feature-local canonical JSON serializer:
  - [x] Sort object keys recursively.
  - [x] Preserve array order.
  - [x] Preserve JSON scalar values exactly.
- [x] Hash exactly `editorGraph`, `inputSchema`, `runtimeIr`, `validationSummary`, and `testSummary`.
- [x] Compute lowercase SHA-256 with `node:crypto`; add no dependency.
- [x] Use the same canonical bytes for payload-size calculation and hashing.

## 5. Repository and optimistic concurrency

- [x] Add `ProjectDraftRepo` using `prismaService.getClient()` at call time.
- [x] Accept the shared Project access policy's typed predicate; do not inspect roles in the
      repository.
- [x] Read the accessible non-deleted Project before returning its nullable draft.
- [x] First save:
  - [x] Require `expectedVersion = 0`.
  - [x] Insert version `1` under the unique `projectId` constraint.
  - [x] On a concurrent unique conflict, return current state only when the hash matches; otherwise
        return a version conflict.
- [x] Existing save:
  - [x] Update atomically where `projectId` and `version = expectedVersion`.
  - [x] Increment version and update hash/save audit fields only when content differs.
  - [x] If no row updates, perform one lookup: matching hash is an idempotent retry; differing hash
        is stale.
- [x] Use PostgreSQL conditional writes as the concurrency boundary; do not add a Redis lock.
- [x] Do not perform database operations inside loops.

## 6. Domain service

- [x] Extract Project ownership/scope resolution from private `ProjectService` methods into a
      feature-local access policy shared by Project and Project Draft.
- [x] For reads, unrestricted `null` wins over `OWN`; no supported scope is denied.
- [x] For `OWN` read, resolve the caller's non-deleted Publisher account even when blocked.
- [x] For save, require `OWN` plus an active, non-deleted Publisher account; unrestricted `null`
      does not grant draft editing.
- [x] Return Project-not-found for missing and cross-owner access.
- [x] Return `409 Error.ProjectArchived` when saving an archived Project.
- [x] Return `409 Error.ProjectDraftVersionConflict` with
      `details: { currentVersion }` for stale differing content.
- [x] Extend the shared exception response boundary to preserve explicitly supplied safe `details`
      without exposing arbitrary exception data.
- [x] Treat identical retries as success without incrementing version or changing save audit data.
- [ ] On conflict, let Studio fetch the cloud draft into a separate tab. An explicit local overwrite
      reuses the normal save endpoint with the newly fetched version; do not add graph merging or a
      force-write endpoint. This is a Studio integration task and does not block the Backend phase.
- [x] Do not add routine successful-save logs; rely on centralized request/error logging.
- [x] Never log graphs, schemas, Runtime IR, summaries, credentials, or private workflow inputs.

## 7. Controller, module, and permissions

- [x] Keep Project Draft in its own feature module/folder and import the shared
      `ProjectAccessPolicy` from `ProjectModule`.
- [x] Keep both routes Bearer-protected and use `@ActiveUser()` plus
      `@ActivePermissionScopes()`.
- [x] Apply `CustomZodValidationPipe` explicitly to Draft route parameters and bodies so validation
      works in both compiled and `tsx` development runtimes.
- [x] Create/resolve route permissions through the API; do not run the permission seed.
- [x] Assign draft `GET` with `OWN` to Customer and Publisher.
- [x] Assign draft `GET` with unrestricted `null` scope to Admin.
- [x] Assign draft `PUT` with `OWN` only to Publisher.
- [x] Append permission IDs without removing unrelated existing role assignments.

## 8. Verification

- [x] Migration is deployed by the user and introspected successfully.
- [x] First save creates version `1` (focused service test).
- [x] Matching `expectedVersion` with changed content increments once (focused service/repository test).
- [x] Identical retry returns the same compact synchronization metadata without incrementing
      (focused service test).
- [x] Stale differing content returns the stable conflict and current version (focused service and
      exception-boundary tests).
- [x] Two concurrent saves using the same expected version allow only one content change against
      PostgreSQL: one returned version `3`, and the loser returned `409` with `currentVersion: 3`.
- [x] Missing draft read returns `{ draft: null }` for an accessible Project.
- [x] Customer/Publisher reads and active-Publisher saves are enforced by focused tests and compiled
      authenticated HTTP checks. A temporarily blocked Publisher retained owned read through the
      Customer role but received `403` for save/create, then was restored to `ACTIVE`.
- [x] One Publisher cannot read or save another Publisher's draft; both compiled HTTP checks return
      `404 Error.ProjectNotFound`.
- [x] Unrestricted Admin reads are supported across owners. Admin has no unrestricted draft-save
      permission; an Admin+Publisher account remains limited by Publisher `OWN` on `PUT`.
- [x] Archived Project draft remains readable and rejects saving.
- [x] Oversized content is rejected before persistence.
- [x] JSON arrays/scalars are rejected for object-only fields.
- [x] Audit user/time and content hash writes are covered by focused repository/service assertions.
- [x] Failures are logged centrally without draft payloads; routine successful saves add no logs.
- [x] Run agreed tests, `npm run build`, `npm run lint`, formatting, and `git diff --check`.
- [x] Run compiled-server HTTP validation checks; malformed UUID and negative `expectedVersion`
      both return `422`.

## 9. Completion criteria

- [x] The Backend API safely reads and saves the current mutable draft for Studio.
- [x] Concurrent Studio sessions cannot silently overwrite one another.
- [x] Retry behavior is deterministic and idempotent.
- [x] Authorization follows the existing Project ownership policy.
- [x] Invalid, archived, cross-owner, and oversized writes fail with stable responses.
- [x] `studio_workflow_checklist.md` and the plan spec are updated with verified results.

## Deferred to later phases

- Graph topology, node schema, binding, loop, condition, and error-policy validation.
- Backend-authoritative validation summaries and Runtime IR consistency checks.
- Assets and screenshots.
- Immutable Workflow Revision creation and Web submission.
- Runtime execution history, device state, secrets, and credentials.
