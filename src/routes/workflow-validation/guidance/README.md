# Workflow Validation Engine

This module validates Editor Graph content and returns deterministic diagnostics. It performs no
workflow persistence, job orchestration, compilation, packaging, or execution.

## Callers

```text
Authenticated test API ─┐
                        ├─> WorkflowValidationService.validate(editorGraph)
Submission worker ──────┘
```

Studio editing validation runs locally through the Go Runtime Agent. The Backend engine is the
cloud validation authority used during submission processing. The HTTP adapter exists for direct
Backend and manual testing.

## HTTP adapter

```text
POST /api/v1/workflow-validation
  -> global authentication
  -> strict outer envelope parsing
  -> content-only validation service
  -> deterministic result
```

`@SkipPermissionCheck()` skips route RBAC, not authentication. A valid token, active user, active
role, active device, and valid session are still required.

## Result semantics

HTTP `200` means validation completed:

- `VALID`: no diagnostics;
- `VALID_WITH_WARNINGS`: warnings and no errors;
- `INVALID`: contract, topology, catalog, port, or config errors exist.

HTTP failures mean validation could not run:

- `400`/`422`: malformed outer request;
- `401`: authentication/session failure;
- `413 Error.EditorGraphPayloadTooLarge`: graph exceeds 1 MiB;
- `500`: unexpected catalog, database, or server failure.

## Engine passes

1. Enforce the 1 MiB Editor Graph limit.
2. Parse Editor Graph schema version 1 internally.
3. Map graph contract failures to `EDITOR_GRAPH_CONTRACT_INVALID`.
4. Enforce node/edge limits.
5. Validate IDs, Start/entry, endpoints, End behavior, reachability, and cycles.
6. Load distinct active Node Definitions in one batched query.
7. Validate active types, source ports, and static `config`.
8. Sort and cap diagnostics and derive status.

`bindings` are opaque in this phase. Binding types, conditions, controlled loops, retries,
error-policy semantics, Runtime IR, assets, and credentials are deferred.

## Schema-version policy

`schemaVersion` belongs to the Editor Graph JSON contract. Publishing additional node types does
not change it. A future breaking graph-format change should add a version-specific parser and
normalize that version into the shared internal representation before semantic validation.

## Files

| File                                  | Responsibility                                 |
| ------------------------------------- | ---------------------------------------------- |
| `workflow-validation.controller.ts`   | Authenticated HTTP testing adapter             |
| `workflow-validation.service.ts`      | Reusable validation pipeline                   |
| `workflow-validation.repo.ts`         | Batched active Node Definition read            |
| `validator/editor-graph.validator.ts` | Topology, catalog checks, result assembly      |
| `validator/node-config.validator.ts`  | MVP config-schema interpreter                  |
| `workflow-validation.model.ts`        | Request, Editor Graph, and result contracts    |
| `workflow-validation.constant.ts`     | Limits, statuses, codes, and safe messages     |
| `workflow-validation.error.ts`        | Failures that prevent validation               |
| `test/`                               | Contract, engine, service, repository, HTTP    |
| `guidance/MANUAL_TESTING.md`          | Postman setup, payloads, and expected outcomes |

## Safety and performance invariants

- Maximum 500 nodes and 1,000 edges.
- Maximum 100 returned diagnostics.
- One catalog query for all distinct node types.
- No database operations inside validator loops.
- No graph/config/binding payloads in logs or error responses.
- Expected workflow invalidity is a result, not an exception.

See [HOW_TO_READ.md](HOW_TO_READ.md) for the code path and
[MANUAL_TESTING.md](MANUAL_TESTING.md) for executable Postman cases.
