Below is the Backend implementation checklist, divided into small reviewable slices. Each slice should be reviewed and approved before starting the next one.

# Backend Studio Workflow Checklist

## Current status — Node Catalog MVP audit (2026-10-09)

**Status: Backend Node Catalog phase complete; executable Runtime verification is deferred to the
Phase 11 integration checkpoint.**

The Backend currently has the Node Definition contract, 11 predefined MVP nodes, catalog tables,
an idempotent publisher, Runtime compatibility filtering, a protected read API, deterministic
catalog hashing, and ETag support.

Node Catalog closing gates:

- [x] Restore committed automated tests and representative valid/invalid fixtures for definition
      validation, publication behavior, Runtime compatibility filtering, disabled-node filtering,
      ETag handling, and response serialization.
- [x] Assign permission `422b891d-7d48-43c9-bd95-aaa9c2fd08ba`
      (`GET /api/v1/node-catalog`) to the role used by Studio without replacing its existing
      permission IDs. Admin already had it; Publisher was updated from 0 to 1 permission.
- [x] Run an authenticated HTTP smoke test after the explicit query-validation fix:
  - [x] Valid `runtimeVersion=0.1.0` returns `200` and 11 nodes.
  - [x] Missing or malformed `runtimeVersion` returns `422` instead of `500`.
  - [x] Matching `If-None-Match` returns `304`.
  - [x] Missing authentication returns `401`.
  - [x] Authenticated Customer role without the catalog permission returns `403`.
- [x] Defer executable Runtime handler confirmation to Phase 11. This workspace currently contains
      Runtime design documents but no Runtime source repository to inspect or test.

MVP decisions that supersede the original versioned-catalog plan:

- Node identity is the unique mutable `type`; there is no `NodeDefinitionVersion` table or
  node-level version field for the MVP.
- Published definitions may be updated by the system catalog publisher.
- The Backend-owned schema envelope has no external `$schema` field and does not use Ajv yet.
- Exact pinned-node resolution, deprecation, conditional nodes, loops, retries, and bindings remain
  deferred until the linear Android workflow works end-to-end.

## Phase 0 — Freeze the contracts

- [x] Define Editor Graph schema v1.
- [ ] Define Runtime IR schema v1.
- [x] Define Node Definition JSON format.
- [x] Define node instance format.
- [x] Define control-edge format.
- [ ] Define structured parameter bindings:
  - [ ] `CONSTANT`
  - [ ] `WORKFLOW_INPUT`
  - [ ] `NODE_OUTPUT`
  - [ ] `LOOP_VARIABLE`
- [x] Define standard control ports:
  - [x] `success`
  - [x] `error`
  - [x] `true`
  - [x] `false`
  - [x] `body`
  - [x] `completed`
- [ ] Define error policy:
  - [ ] Stop when no error edge exists.
  - [ ] Follow the error edge when configured.
  - [ ] Optional bounded retry.
- [ ] Define controlled `for` and `while` loop structures.
- [x] Define node and graph validation error codes.
- [x] Define strict semantic-version comparison for Runtime compatibility.
- [x] Decide whether to add Ajv: deferred; use the Backend-owned strict schema envelope for MVP.
- [x] Add representative valid and invalid JSON fixtures.
- [ ] Review the contracts with the Studio and Runtime developers.

### Completion criteria

- [ ] Studio, Backend, and Runtime interpret the same fixtures consistently.
- [x] No executable JavaScript or arbitrary expression language exists in the Node Definition
      contract.
- [x] ~~Existing drafts can pin exact node versions.~~ Deferred with node versioning.

---

## Phase 1 — Node Catalog database migration

Create the SQL-first migration for:

- [x] `Capability`.
- [x] `NodeDefinition`.
- [x] ~~`NodeDefinitionVersion`.~~ Superseded by the mutable MVP catalog decision.
- [x] `NodeDefinitionCapability`.
- [x] `NodeDefinitionStatus` enum.
- [x] Unique constraint for node `type`.
- [x] ~~Unique constraint for node identity and version.~~ Not applicable without node versions.
- [x] Positive timeout constraint.
- [x] ~~Positive version constraint.~~ Not applicable without node versions.
- [x] JSON object constraints.
- [x] Indexes required for active catalog queries.
- [x] Deliberate foreign-key deletion behavior: database default `NO ACTION`.
- [x] Remove the requirement for an ordinary `createdById`.
- [x] Use the explicit system catalog publisher instead of `publishedById`.
- [x] ~~Confirm published versions are immutable.~~ Superseded; current definitions are mutable by
      system publication.

### Migration gate

- [x] Create and review the forward-only migration.
- [x] Stop before applying it.
- [x] User applies the migration.
- [x] Introspect PostgreSQL into `schema.prisma`.
- [x] Generate the Prisma client.
- [x] Review generated model relationships.
- [x] Build the Backend.

### Completion criteria

- [x] PostgreSQL enforces catalog identity, timeout, hash, and JSON-shape invariants.
- [x] No generated file was manually edited.
- [x] Database application was confirmed only after the user applied the migration.

---

## Phase 2 — Version-controlled node definitions

Create the predefined catalog source files.

### Initial nodes

- [x] `flow.start`
- [x] `flow.end`
- [x] `flow.delay`
- [x] `utility.log`
- [x] `android.launch_app`
- [x] `android.tap`
- [x] `android.swipe`
- [x] `android.input_text`
- [x] `android.press_back`
- [x] `android.press_home`
- [x] `android.screenshot`

### Second control-flow group

- [ ] `flow.if`
- [ ] `flow.for`
- [ ] `flow.while`

### For each definition

- [x] Stable unique type.
- [x] ~~Integer node version.~~ Not used for MVP.
- [x] Display name, description, category, and icon.
- [x] Runtime handler.
- [x] Minimum Runtime version.
- [x] Default timeout.
- [x] Configuration schema.
- [x] Input schema.
- [x] Output schema.
- [x] Output ports.
- [x] Supported error policies.
- [x] Required capabilities.
- [x] Studio editor hints.
- [ ] Valid example node instance.
- [ ] Invalid example cases.

### Completion criteria

- [x] All definitions validate before database insertion.
- [x] Defer Runtime handler registration confirmation to the Phase 11 integration checkpoint.
- [x] Basic linear Android workflows can be represented without custom nodes.

---

## Phase 3 — Catalog publication command

- [x] Implement an explicit catalog import/publication command.
- [x] Load version-controlled definitions.
- [x] Validate every definition before opening a transaction.
- [x] Insert missing capabilities in a set-based operation.
- [x] Insert or update node identities in a set-based operation.
- [x] ~~Insert only new node versions.~~ Replaced by content-hash-based mutable upsert.
- [x] ~~Reject mutation of an existing published version.~~ Not applicable without versions.
- [x] Attach capabilities to current node definitions.
- [x] Make repeated publication idempotent.
- [x] Fail the entire publication if one contract is invalid.
- [x] Log synchronization counts without dumping complete schemas from the publisher.
- [x] Do not expose catalog publication through a public HTTP endpoint.

### Tests

- [x] Valid catalog publication manually verified against PostgreSQL.
- [x] Repeated publication manually verified as 11 unchanged definitions.
- [x] ~~Conflicting immutable version is rejected.~~ Not applicable without versions.
- [x] Invalid schema is rejected before publication.
- [x] Missing capability reference is rejected.
- [x] Repository synchronization is not called when publisher preflight validation fails.

---

## Phase 4 — Node Catalog read API

- [x] Add a protected Studio catalog endpoint.
- [x] Accept and explicitly validate the Studio/Runtime version.
- [x] Return the compatible current `ACTIVE` definition for each node type.
- [x] Exclude `DISABLED` nodes from new workflows.
- [x] ~~Mark `DEPRECATED` versions appropriately.~~ Deferred with node versioning.
- [x] ~~Resolve exact versions pinned by drafts.~~ Deferred with node versioning.
- [x] Return capabilities and all Studio schemas/hints.
- [x] Compute a deterministic `catalogHash`.
- [x] Support `ETag` and `If-None-Match`.
- [x] Use the global response envelope.
- [x] Defer pagination while the catalog is intentionally small.
- [x] Create the route permission through the existing permission API.
- [x] Assign the route permission to Admin and Publisher while preserving their existing IDs.
- [x] Do not expose internal publication metadata unnecessarily.

### Tests

- [x] Current compatible definitions are selected.
- [x] Incompatible Runtime versions are excluded.
- [x] ~~Pinned deprecated versions remain resolvable.~~ Deferred with node versioning.
- [x] Disabled definitions cannot be selected for new nodes.
- [x] ETag produces `304 Not Modified`.
- [x] Missing authentication returns `401`; a role without permission returns `403`.
- [x] Response schema serialization succeeds.
- [x] Missing and malformed `runtimeVersion` return `422` without calling the service.

---

## Phase 5 — Project database and module

Create the cloud Project container.

**Status: implemented, migrated, permissioned, and production-equivalent CRUD smoke-tested.
Dedicated multi-user ownership/blocking fixtures are still required for the unchecked tests.**

- [x] Add `ProjectStatus`.
- [x] Add `Project`.
- [x] Make `PublisherAccount` the owner.
- [x] Record creating, updating, and future soft-deleting users.
- [x] Add active-project indexes.
- [x] Implement create project.
- [x] Implement project list.
- [x] Implement project detail.
- [x] Implement rename/update metadata.
- [x] Implement archive.
- [x] Prevent archived-project modification.
- [x] Consistently exclude soft-deleted projects.
- [x] Apply access rules: Publisher-only unscoped create, Customer/Publisher `OWN` reads, Publisher
      `OWN` update/archive, and Admin unrestricted list/detail/update/archive.
- [x] Resolve blocked, non-deleted Publisher accounts for `OWN` reads; derive create ownership from
      the authenticated user and require an active Publisher account for create and Publisher-owned
      mutations.
- [x] Let unrestricted Admin update/archive bypass owner Publisher status while preserving Project
      lifecycle rules.
- [x] On Publisher block, remove the Publisher role while preserving Customer read access and the
      `PublisherAccount` ownership anchor; restore the role on reactivation.
- [x] Avoid resolving a Publisher account for unrestricted Admin access.
- [x] Keep Project authorization coupled only to `@ActivePermissionScopes()`, not role names or the
      role permission cache payload.
- [x] Avoid routine Project success logs; rely on centralized request/error logging for failures.

### Tests

- [x] Active publisher can create a project.
- [ ] Non-publisher cannot create one.
- [ ] One publisher cannot access another publisher’s project.
- [ ] Blocked former publisher can read owned projects but cannot create or mutate.
- [ ] Admin can list, read, update, and archive across owners.
- [x] Admin plus Publisher scope aggregation resolves to unrestricted access.
- [x] Archived projects are readable but immutable.
- [ ] Deleted records do not appear in normal queries.

---

## Phase 6 — Mutable Project Draft

**Status: Backend complete and live-verified on 2026-10-15. Studio conflict-tab UX is deferred to
client integration.**

- [x] Add one `ProjectDraft` per Project.
- [x] Create the cloud Project only on the first explicit Studio Save to Cloud; never create an empty
      draft with the Project.
- [x] Enforce case-insensitive Project-name uniqueness per Publisher across active and archived
      Projects so a repeated cloud-create request returns the same active Project ID.
- [x] Treat cloud state as authoritative when another device opens a Project.
- [x] Create the row lazily; `expectedVersion = 0` means first save.
- [x] Store `editorGraph`.
- [x] Store `inputSchema`.
- [x] Store optional `runtimeIr`.
- [x] Store validation summary.
- [x] Store informational test summary.
- [x] Store content hash.
- [x] Store version, save time, and saving user.
- [x] Add JSON object constraints.
- [x] Limit canonical draft content to 1 MiB.
- [x] Compute the hash from recursively key-sorted canonical JSON with array order preserved.
- [x] Implement `GET /projects/:projectId/draft`; return `{ projectStatus, draft: null }` when no row
      exists.
- [x] Implement draft save with `expectedVersion`.
- [x] Implement `PUT /projects/:projectId/draft` for Publisher `OWN` only.
- [x] Return full draft content only from `GET`; keep `savedById` internal.
- [x] Return compact `id`, `version`, `contentHash`, and `savedAt` synchronization metadata from
      `PUT` instead of echoing draft content.
- [x] Allow Customer/Publisher `OWN` reads and unrestricted Admin reads; Admin does not save drafts
      in the MVP.
- [x] Extract one feature-local Project access policy shared by Project and Project Draft.
- [x] Apply explicit Zod validation pipes to Draft path/body inputs for compiled and `tsx` runtimes.
- [x] Perform an atomic conditional update in PostgreSQL.
- [x] Increment version only when content changes.
- [x] Treat an identical retry as idempotent.
- [ ] On a differing conflict, fetch cloud content into another Studio tab and reuse the normal save
      with the latest version only after explicit overwrite confirmation. Backend conflict behavior
      is complete; this remaining item belongs to Studio integration.
- [x] Return `409 Error.ProjectDraftVersionConflict` with `details: { currentVersion }` for stale
      differing content and preserve those safe details through the shared exception boundary.
- [x] Keep archived Project drafts readable but reject saving.
- [x] Do not use a Redis lock for ordinary draft saving.
- [x] Do not store Runtime execution history or credentials.
- [x] Do not add routine successful-save logs; keep draft payloads out of centralized error logs.

### Tests

- [x] First draft creation.
- [x] Successful versioned update.
- [x] Stale update rejection.
- [x] Identical retry behavior.
- [x] Concurrent save allows only one expected version against PostgreSQL.
- [x] Cross-publisher read/save access is rejected with `404 Error.ProjectNotFound`.
- [x] Archived project rejects draft modification.
- [x] Oversized payload is rejected.

---

## Phase 7 — Basic graph validation

**Status: Backend complete and approved. Manual Postman execution is pending.**

Validate cloud workflow content before submission build processing. Studio editing validation runs
through the local Go Runtime Agent; Cloud Draft Save may persist invalid content and does not call
this Backend engine.

### Module boundary

- [x] Validation engine owns workflow contract/type/topology/catalog diagnostics only.
- [x] Future submission worker calls the engine with immutable submitted revision content.
- [x] Expose authenticated `POST /workflow-validation` for direct Backend testing.
- [x] Keep the service input limited to workflow content.
- [x] Parse incomplete workflow objects inside the engine and return bounded
      `EDITOR_GRAPH_CONTRACT_INVALID` diagnostics.
- [x] Skip route RBAC on the testing adapter while retaining global authentication checks.

- [x] Supported graph schema version.
- [x] Unique node IDs.
- [x] Unique edge IDs.
- [x] Exactly one Start node.
- [x] At least one reachable End node.
- [x] Every edge references existing nodes.
- [x] Every source port exists.
- [x] No edge leaves an End node.
- [x] No unreachable nodes.
- [x] No uncontrolled cycles.
- [ ] Required conditional branches exist.
- [x] Node type exists as an active current definition in the catalog.
- [x] Node configuration matches its schema.
- [x] Graph node-count limit.
- [x] Graph edge-count limit.
- [x] Cap returned diagnostics.
- [x] Return node/edge identifiers with errors.

### Completion criteria

Backend returns deterministic:

- [x] `INVALID`
- [x] `VALID_WITH_WARNINGS`
- [x] `VALID`

Drafts may be saved while invalid, but an invalid draft cannot later be finalized.

- [x] Temporary HTTP adapter and future worker use the same content-only service contract.
- [x] HTTP `200` means validation completed; workflow errors are represented by `INVALID` and
      diagnostics.
- [x] Workflow Validation performs only the batched active Node Definition read.

---

## Phase 8 — Bindings and output validation

- [ ] Validate constant values against target input types.
- [ ] Validate workflow-input references.
- [ ] Validate node-output references.
- [ ] Validate output paths against the source output schema.
- [ ] Validate source and target type compatibility.
- [ ] Reject references to nonexistent nodes or fields.
- [ ] Reject references that cannot execute before the consumer.
- [ ] Validate loop-variable scope.
- [ ] Reject arbitrary expression strings.
- [ ] Reject credentials and secret values in persisted bindings.

### Tests

- [ ] Constant binding.
- [ ] Workflow-input binding.
- [ ] Previous-node output binding.
- [ ] Invalid output path.
- [ ] Type mismatch.
- [ ] Future/unreachable node reference.
- [ ] Loop variable used outside its scope.

---

## Phase 9 — Conditional, loop, and error validation

### Conditional flow

- [ ] `flow.if` has `true` and `false` branches.
- [ ] Its condition resolves to a boolean.
- [ ] Both branches can terminate or rejoin safely.

### For loop

- [ ] Count accepts a valid integer binding.
- [ ] Count cannot be negative.
- [ ] Maximum iteration limit is mandatory.
- [ ] Loop index is scoped to the loop body.
- [ ] `body` and `completed` ports are valid.

### While loop

- [ ] Condition resolves to a boolean.
- [ ] Maximum iteration limit is mandatory.
- [ ] Optional delay is bounded.
- [ ] The loop body returns only through the controlled loop structure.

### Error flow

- [ ] Fallible nodes expose an `error` port.
- [ ] Missing error edge means stop execution.
- [ ] Connected error edge targets a valid node.
- [ ] Retry count and delay are bounded.
- [ ] An error path cannot create an uncontrolled cycle.

---

## Phase 10 — Runtime IR consistency validation

- [ ] Validate supported IR version.
- [ ] Validate IR node IDs against Editor Graph IDs.
- [ ] Validate the Runtime handler and node type against the current catalog.
- [ ] Validate Runtime compatibility.
- [ ] Validate transitions and named ports.
- [ ] Validate bindings and loop instructions.
- [ ] Derive required capabilities from the current node definitions.
- [ ] Compare derived capabilities with the IR manifest.
- [ ] Reject missing or extra privileged capabilities.
- [ ] Compute a deterministic IR content hash.
- [ ] Associate test summaries with that exact hash.

Backend should validate consistency, not silently recompile or repair the graph.

---

## Phase 11 — Studio and Runtime integration checkpoint

Test one complete workflow:

```text
Start
→ Launch App
→ Delay
→ Tap
→ Input Text
→ Swipe
→ Screenshot
→ End
```

- [x] Backend publishes the required 11-node MVP catalog.
- [ ] Studio fetches and caches it.
- [ ] Studio creates nodes using published node types.
- [ ] Studio compiles the graph into IR.
- [ ] Backend saves the draft without requiring workflow validity.
- [ ] Submission processing validates the immutable submitted Workflow Revision.
- [ ] Runtime recognizes every required handler.
- [ ] Runtime executes the workflow.
- [ ] Studio displays execution results.
- [ ] Test summary references the exact IR hash.

Then test:

- [ ] `If` branching.
- [ ] `For` loop.
- [ ] Bounded `While` loop.
- [ ] Error edge.
- [ ] Previous-node output binding.
- [ ] Runtime incompatibility.
- [x] ~~Deprecated pinned node version.~~ Deferred with node versioning.

---

## Phase 12 — Hardening and documentation

- [ ] Document Catalog API behavior.
- [ ] Document draft conflict handling.
- [x] Document schema-version compatibility for the Basic Editor Graph validator.
- [ ] Document node publication procedure.
- [ ] Document how to introduce or update a system-owned node definition.
- [x] Confirm centralized failure logs cover catalog/project/draft/validation errors without feature
      success logs; the existing global request middleware behavior is unchanged.
- [x] Confirm Workflow Validation adds no graph/config/binding payloads or secrets to logs.
- [x] Focused Node Catalog tests passed (6 files, 21 tests).
- [x] Focused Workflow Validation tests passed.
- [x] Full Backend unit suite passed (18 files, 79 tests).
- [ ] Execute the documented authenticated Postman cases against the running Backend.
- [x] Run lint for the Node Catalog implementation.
- [x] Run a clean full Backend build after resolving the unrelated top-up configuration typing
      errors.
- [x] Run `git diff --check`.
- [x] Report live database publication and HTTP checks separately from static checks.
- [x] Update the implementation checklist and module guidance with completed behavior.

## Deferred from this checklist

- Asset upload and references.
- Workflow Revision creation.
- Product Submission.
- Packaging and encryption.
- Execution leases.
- OCR and image matching.
- External connectors.
- Arbitrary code nodes.
- Custom publisher nodes.
- Parallel graph branches.
- Advanced retry/catch scopes.
- Node auto-migration.

The Backend Node Catalog closing gates are completed. Runtime handler registration remains an
explicit Phase 11 cross-component integration task.
