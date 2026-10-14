# Phase 4 — Cloud Workflow Validation Engine

**Status:** Backend implementation complete and approved.

This phase provides a reusable Backend engine that validates Editor Graph content for cloud
processing. Studio editing validation runs locally through the Go Runtime Agent. Cloud saves may
contain incomplete or invalid workflow content.

## 1. Implemented boundary

- [x] Accept one `editorGraph` JSON object.
- [x] Validate workflow contract, topology, active node types, source ports, and static config.
- [x] Return deterministic machine-readable diagnostics without persisting a result.
- [x] Keep validators database-free; perform one batched active Node Definition query.
- [x] Exclude bindings, conditional/loop/error semantics, Runtime IR, compilation, packaging, and
      execution from this phase.
- [x] Expose a temporary authenticated HTTP adapter for Backend testing.
- [x] Keep the service reusable by a future submission-processing worker.

## 2. Entry points

### Temporary HTTP adapter

```http
POST /api/v1/workflow-validation
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "editorGraph": {}
}
```

The endpoint uses `@SkipPermissionCheck()` to skip route RBAC. The global guard still requires a
valid access token, active user, active role, active device, and valid session.

### Reusable service

```ts
validate(editorGraph: unknown): Promise<WorkflowValidationOutput>
```

The future background worker passes immutable submitted Editor Graph content to this same service
and owns any surrounding persistence or build orchestration.

## 3. Request and result semantics

The outer request is strict and contains exactly one JSON-object `editorGraph` field. A missing
field, array/null value, invalid JSON, or unknown outer field returns `400`/`422` because validation
could not start.

Once an Editor Graph object reaches the engine, graph contract and workflow errors are normal
validation results:

```json
{
  "status": "INVALID",
  "errors": [
    {
      "code": "EDGE_TARGET_NODE_NOT_FOUND",
      "message": "Edge target node does not exist",
      "edgeId": "edge_01",
      "nodeId": "missing_node",
      "path": ["edges", 0, "targetNodeId"]
    }
  ],
  "warnings": [],
  "truncated": false
}
```

- `VALID`: no diagnostics.
- `VALID_WITH_WARNINGS`: warnings and no errors.
- `INVALID`: one or more workflow errors.
- HTTP `200`: validation completed, including an `INVALID` result.
- HTTP `401`: authentication failed.
- HTTP `413 Error.EditorGraphPayloadTooLarge`: graph exceeds the processing limit.
- HTTP `500`: unexpected catalog, database, or server failure.

## 4. Schema-version policy

`schemaVersion` versions the Editor Graph document structure, not the Node Catalog.

- Adding a new node type does not change the graph schema version.
- Existing graphs remain on schema version `1` when new node types are published.
- A future breaking change to graph/node/edge JSON introduces another graph schema version.
- Multiple versions should be handled by version-specific parsers that normalize to one internal
  graph representation before shared semantic validation.

The current engine supports Editor Graph schema version `1`. Another positive integer is
well-formed content and returns `GRAPH_SCHEMA_VERSION_UNSUPPORTED`.

## 5. Validation pipeline

1. Enforce the 1 MiB serialized Editor Graph limit.
2. Parse the strict Editor Graph v1 contract internally.
3. Return `EDITOR_GRAPH_CONTRACT_INVALID` for graph contract/type failures.
4. Enforce maximum 500 nodes and 1,000 edges.
5. Build identity and adjacency indexes and report duplicate IDs.
6. Require exactly one `flow.start` matching `entryNodeId`.
7. Validate edge endpoints and reject outgoing edges from `flow.end`.
8. Report unreachable nodes, require a reachable End, and reject directed cycles.
9. Deduplicate node types and load active definitions in one database query.
10. Validate active types, source ports, and static `config`.
11. Sort and cap diagnostics and derive the final status.

The MVP config subset supports required fields, additional-property rejection, string
length/pattern, integer/number range, and boolean type. `bindings` remain opaque in this phase.

## 6. Limits and diagnostics

- Serialized Editor Graph: maximum 1 MiB; exceeding it returns HTTP `413`.
- Nodes: maximum 500; exceeding it returns `200 INVALID`.
- Edges: maximum 1,000; exceeding it returns `200 INVALID`.
- Returned diagnostics: maximum 100; additional diagnostics set `truncated: true`.
- Diagnostics contain stable codes, safe messages, paths, and optional node/edge IDs.
- Responses and logs never copy graph/config/binding values, raw definitions, or stack traces.

Implemented diagnostic codes:

- `EDITOR_GRAPH_CONTRACT_INVALID`
- `GRAPH_SCHEMA_VERSION_UNSUPPORTED`
- `NODE_ID_DUPLICATED`
- `EDGE_ID_DUPLICATED`
- `START_NODE_COUNT_INVALID`
- `ENTRY_NODE_INVALID`
- `END_NODE_UNREACHABLE`
- `EDGE_SOURCE_NODE_NOT_FOUND`
- `EDGE_TARGET_NODE_NOT_FOUND`
- `EDGE_SOURCE_PORT_NOT_FOUND`
- `END_NODE_HAS_OUTGOING_EDGE`
- `NODE_UNREACHABLE`
- `GRAPH_CYCLE_DETECTED`
- `NODE_TYPE_NOT_ACTIVE`
- `NODE_CONFIG_INVALID`
- `GRAPH_NODE_LIMIT_EXCEEDED`
- `GRAPH_EDGE_LIMIT_EXCEEDED`

## 7. Verification

- [x] Valid Start → End returns `VALID`.
- [x] Graph contract failures return `EDITOR_GRAPH_CONTRACT_INVALID`.
- [x] Topology, catalog, port, and config errors return deterministic `INVALID` diagnostics.
- [x] Malformed outer requests return `422` in controller tests.
- [x] Node/edge and byte limits are enforced before expensive work.
- [x] Repeated node types use one batched catalog query.
- [x] Diagnostics are sorted, capped, and marked when truncated.
- [x] Focused Workflow Validation tests pass.
- [x] Full Backend suite passes: 18 files, 79 tests.
- [x] TypeScript build passes.
- [x] Type-aware lint completes with only unrelated existing warnings.
- [x] `git diff --check` passes.
- [x] Manual authenticated Postman cases are documented in
      `src/routes/workflow-validation/guidance/MANUAL_TESTING.md`.
- [ ] A manual tester has executed the documented cases against the running Backend.

## 8. Completion criteria

- [x] One content-only service contract is reusable from HTTP and background processing.
- [x] Invalid workflow content is represented by structured results, not unexpected exceptions.
- [x] Resource use and diagnostic output are bounded.
- [x] Documentation, implementation, and automated tests agree.
