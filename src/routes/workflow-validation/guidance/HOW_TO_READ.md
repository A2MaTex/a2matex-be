# How to Read This Module

## Mental model

```text
Editor Graph JSON
      ↓
size and contract checks
      ↓
topology validation
      ↓
one active Node Catalog query
      ↓
type, port, and config validation
      ↓
sorted and bounded diagnostics
```

The engine knows only workflow content and the active Node Catalog. Its output is deterministic and
contains no persisted state.

## Reading order

1. Read `test/fixtures/valid-minimal.json` for the smallest valid graph.
2. Read `workflow-validation.model.ts` for the outer envelope, Editor Graph, and result contracts.
3. Read `WorkflowValidationService.validate` for orchestration and early exits.
4. Read `workflow-validation.repo.ts` for the single batched Node Definition query.
5. Read `validateEditorGraphTopology` one numbered pass at a time.
6. Read `validateEditorGraphCatalog`, followed by `node-config.validator.ts`.
7. Read `buildValidationOutput` for sorting, capping, and status derivation.
8. Read the controller last; it authenticates the test request and forwards `editorGraph`.
9. Use `MANUAL_TESTING.md` to connect each rule with an observable API response.

## Trace a valid request

1. The global guard validates the access token, session, user, role, and device.
2. The request pipe confirms exactly one JSON-object `editorGraph` field.
3. The service checks the serialized graph size.
4. Internal Editor Graph parsing succeeds.
5. Topology finds one Start, a reachable End, valid endpoints, and no cycle.
6. The repository loads all distinct active node types in one query.
7. Catalog validation confirms types, source ports, and static config.
8. Result assembly returns HTTP `200` with `status: VALID`.

## Trace invalid graph content

An incomplete graph object reaches the service, fails the strict internal graph parser, and returns
HTTP `200` with `status: INVALID` and `EDITOR_GRAPH_CONTRACT_INVALID` paths.

A structurally valid graph using a missing source port passes contract parsing, reaches catalog
validation, and returns `EDGE_SOURCE_PORT_NOT_FOUND` with its edge ID, node ID, and graph path.

An unsupported positive `schemaVersion` passes contract parsing and returns
`GRAPH_SCHEMA_VERSION_UNSUPPORTED`. Adding new node types to the catalog does not change the graph
schema version.

## Trace requests that cannot be validated

- `401`: inspect access token, session, active user/role, and device.
- `400`/`422`: inspect the outer request body and JSON syntax.
- `413 Error.EditorGraphPayloadTooLarge`: reduce the serialized Editor Graph below 1 MiB.
- unexpected `500`: inspect catalog/database/server failure logs without logging the graph payload.

## Important implementation rules

- Keep strict Editor Graph parsing inside the service boundary.
- Keep validators pure and database-free.
- Deduplicate node types before the catalog query.
- Stop before catalog access for contract, byte-limit, and graph-count failures.
- Keep `bindings` separate from static `config`.
- Return expected workflow errors as diagnostics instead of exceptions.
- Do not persist validation results or log graph/config/binding values in this module.
