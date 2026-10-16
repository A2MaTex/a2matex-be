# Manual Testing with Postman

This guide exercises the temporary Backend validation adapter. It does not persist validation
results.

## 1. Postman setup

Create environment variables:

```text
base-local = http://localhost:9999/api/v1
accessToken = <empty initially>
```

Log in:

```http
POST {{base-local}}/auth/login
Content-Type: application/json
```

```json
{
  "account": "your-account",
  "password": "your-password"
}
```

Copy `data.accessToken` into the `accessToken` environment variable. Every validation case uses:

```http
POST {{base-local}}/workflow-validation
Authorization: Bearer {{accessToken}}
Content-Type: application/json
```

For HTTP `200`, inspect:

```text
data.status
data.errors
data.warnings
data.truncated
```

Check diagnostics by `code`; their order is deterministic but should not be used as business logic.

## 2. Case summary

| Case                              | Expected HTTP | Expected result/codes                               |
| --------------------------------- | ------------- | --------------------------------------------------- |
| Valid minimum                     | `200`         | `VALID`                                             |
| Valid Android flow                | `200`         | `VALID`                                             |
| Incomplete graph contract         | `200`         | `INVALID`, `EDITOR_GRAPH_CONTRACT_INVALID`          |
| Invalid outer envelope            | `422`         | Validation does not start                           |
| Unsupported schema version        | `200`         | `GRAPH_SCHEMA_VERSION_UNSUPPORTED`                  |
| Missing Start and unreachable End | `200`         | Start, entry, reachability diagnostics              |
| Duplicate IDs                     | `200`         | `NODE_ID_DUPLICATED`, `EDGE_ID_DUPLICATED`          |
| Missing endpoints                 | `200`         | Missing source and target diagnostics               |
| End cycle                         | `200`         | End outgoing, cycle, and source-port diagnostics    |
| Catalog/config errors             | `200`         | Unknown type, source port, config, unreachable node |
| No token                          | `401`         | Authentication failure                              |
| More than 500 nodes               | `200`         | `GRAPH_NODE_LIMIT_EXCEEDED`                         |
| More than 1,000 edges             | `200`         | `GRAPH_EDGE_LIMIT_EXCEEDED`                         |
| More than 1 MiB                   | `413`         | `Error.EditorGraphPayloadTooLarge`                  |

## 3. Valid minimum

Expected: HTTP `200`, `data.status = "VALID"`.

```json
{
  "editorGraph": {
    "schemaVersion": 1,
    "entryNodeId": "start_01",
    "nodes": [
      {
        "id": "start_01",
        "type": "flow.start",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 100, "y": 180 }
      },
      {
        "id": "end_01",
        "type": "flow.end",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 400, "y": 180 }
      }
    ],
    "edges": [
      {
        "id": "edge_01",
        "sourceNodeId": "start_01",
        "sourcePort": "success",
        "targetNodeId": "end_01"
      }
    ]
  }
}
```

## 4. Valid Android workflow

Expected: HTTP `200`, `data.status = "VALID"`.

`bindings` are intentionally opaque in this phase. The case verifies graph topology, node types,
ports, and static config; it does not prove binding type correctness or Android execution.

```json
{
  "editorGraph": {
    "schemaVersion": 1,
    "entryNodeId": "start_01",
    "nodes": [
      {
        "id": "start_01",
        "type": "flow.start",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 100, "y": 200 }
      },
      {
        "id": "home_01",
        "type": "android.press_home",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 300, "y": 200 }
      },
      {
        "id": "launch_okx_01",
        "type": "android.launch_app",
        "config": {},
        "bindings": {
          "packageName": { "kind": "literal", "value": "com.okinc.okex.gp" }
        },
        "errorPolicy": "STOP",
        "editor": { "x": 500, "y": 200 }
      },
      {
        "id": "delay_01",
        "type": "flow.delay",
        "config": {},
        "bindings": {
          "durationMs": { "kind": "literal", "value": 2000 }
        },
        "errorPolicy": "STOP",
        "editor": { "x": 700, "y": 200 }
      },
      {
        "id": "tap_market_01",
        "type": "android.tap",
        "config": {},
        "bindings": {
          "x": { "kind": "literal", "value": 540 },
          "y": { "kind": "literal", "value": 1800 }
        },
        "errorPolicy": "STOP",
        "editor": { "x": 900, "y": 200 }
      },
      {
        "id": "swipe_prices_01",
        "type": "android.swipe",
        "config": {},
        "bindings": {
          "startX": { "kind": "literal", "value": 540 },
          "startY": { "kind": "literal", "value": 1600 },
          "endX": { "kind": "literal", "value": 540 },
          "endY": { "kind": "literal", "value": 600 },
          "durationMs": { "kind": "literal", "value": 500 }
        },
        "errorPolicy": "STOP",
        "editor": { "x": 1100, "y": 200 }
      },
      {
        "id": "screenshot_01",
        "type": "android.screenshot",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 1300, "y": 200 }
      },
      {
        "id": "end_01",
        "type": "flow.end",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 1500, "y": 200 }
      }
    ],
    "edges": [
      {
        "id": "edge_01",
        "sourceNodeId": "start_01",
        "sourcePort": "success",
        "targetNodeId": "home_01"
      },
      {
        "id": "edge_02",
        "sourceNodeId": "home_01",
        "sourcePort": "success",
        "targetNodeId": "launch_okx_01"
      },
      {
        "id": "edge_03",
        "sourceNodeId": "launch_okx_01",
        "sourcePort": "success",
        "targetNodeId": "delay_01"
      },
      {
        "id": "edge_04",
        "sourceNodeId": "delay_01",
        "sourcePort": "success",
        "targetNodeId": "tap_market_01"
      },
      {
        "id": "edge_05",
        "sourceNodeId": "tap_market_01",
        "sourcePort": "success",
        "targetNodeId": "swipe_prices_01"
      },
      {
        "id": "edge_06",
        "sourceNodeId": "swipe_prices_01",
        "sourcePort": "success",
        "targetNodeId": "screenshot_01"
      },
      {
        "id": "edge_07",
        "sourceNodeId": "screenshot_01",
        "sourcePort": "success",
        "targetNodeId": "end_01"
      }
    ]
  }
}
```

## 5. Incomplete Editor Graph contract

Expected: HTTP `200`, `INVALID`, with `EDITOR_GRAPH_CONTRACT_INVALID` diagnostics.

```json
{
  "editorGraph": {
    "nodes": [],
    "unexpectedField": true
  }
}
```

## 6. Invalid outer request envelope

Expected: HTTP `422`; the service is not called.

```json
{
  "editorGraph": []
}
```

Also verify a missing envelope:

```json
{}
```

## 7. Unsupported graph schema version

Expected: HTTP `200`, `INVALID`, with `GRAPH_SCHEMA_VERSION_UNSUPPORTED`.

Use the Valid minimum payload and change only:

```json
{
  "schemaVersion": 2
}
```

This is a field mutation inside `editorGraph`, not a complete request body. New Node Catalog entries
alone do not require a new graph schema version.

## 8. Missing Start and unreachable End

Expected codes include `START_NODE_COUNT_INVALID`, `ENTRY_NODE_INVALID`, `NODE_UNREACHABLE`, and
`END_NODE_UNREACHABLE`.

```json
{
  "editorGraph": {
    "schemaVersion": 1,
    "entryNodeId": "delay_01",
    "nodes": [
      {
        "id": "delay_01",
        "type": "flow.delay",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 100, "y": 180 }
      },
      {
        "id": "end_01",
        "type": "flow.end",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 400, "y": 180 }
      }
    ],
    "edges": []
  }
}
```

## 9. Duplicate node and edge IDs

Expected: `NODE_ID_DUPLICATED` and `EDGE_ID_DUPLICATED`.

```json
{
  "editorGraph": {
    "schemaVersion": 1,
    "entryNodeId": "start_01",
    "nodes": [
      {
        "id": "start_01",
        "type": "flow.start",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 100, "y": 180 }
      },
      {
        "id": "end_01",
        "type": "flow.end",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 400, "y": 180 }
      },
      {
        "id": "end_01",
        "type": "flow.end",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 400, "y": 300 }
      }
    ],
    "edges": [
      {
        "id": "edge_01",
        "sourceNodeId": "start_01",
        "sourcePort": "success",
        "targetNodeId": "end_01"
      },
      {
        "id": "edge_01",
        "sourceNodeId": "start_01",
        "sourcePort": "success",
        "targetNodeId": "end_01"
      }
    ]
  }
}
```

## 10. Missing edge endpoints

Expected: `EDGE_SOURCE_NODE_NOT_FOUND` and `EDGE_TARGET_NODE_NOT_FOUND`.

```json
{
  "editorGraph": {
    "schemaVersion": 1,
    "entryNodeId": "start_01",
    "nodes": [
      {
        "id": "start_01",
        "type": "flow.start",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 100, "y": 180 }
      },
      {
        "id": "end_01",
        "type": "flow.end",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 400, "y": 180 }
      }
    ],
    "edges": [
      {
        "id": "valid_edge",
        "sourceNodeId": "start_01",
        "sourcePort": "success",
        "targetNodeId": "end_01"
      },
      {
        "id": "missing_source",
        "sourceNodeId": "unknown_source",
        "sourcePort": "success",
        "targetNodeId": "end_01"
      },
      {
        "id": "missing_target",
        "sourceNodeId": "start_01",
        "sourcePort": "success",
        "targetNodeId": "unknown_target"
      }
    ]
  }
}
```

## 11. Cycle and outgoing edge from End

Expected codes include `GRAPH_CYCLE_DETECTED`, `END_NODE_HAS_OUTGOING_EDGE`, and
`EDGE_SOURCE_PORT_NOT_FOUND`.

```json
{
  "editorGraph": {
    "schemaVersion": 1,
    "entryNodeId": "start_01",
    "nodes": [
      {
        "id": "start_01",
        "type": "flow.start",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 100, "y": 180 }
      },
      {
        "id": "end_01",
        "type": "flow.end",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 400, "y": 180 }
      }
    ],
    "edges": [
      {
        "id": "edge_01",
        "sourceNodeId": "start_01",
        "sourcePort": "success",
        "targetNodeId": "end_01"
      },
      {
        "id": "edge_02",
        "sourceNodeId": "end_01",
        "sourcePort": "success",
        "targetNodeId": "start_01"
      }
    ]
  }
}
```

## 12. Catalog, source-port, and config errors

Expected codes include `NODE_TYPE_NOT_ACTIVE`, `EDGE_SOURCE_PORT_NOT_FOUND`,
`NODE_CONFIG_INVALID`, and `NODE_UNREACHABLE`.

```json
{
  "editorGraph": {
    "schemaVersion": 1,
    "entryNodeId": "start_01",
    "nodes": [
      {
        "id": "start_01",
        "type": "flow.start",
        "config": { "unexpected": true },
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 100, "y": 180 }
      },
      {
        "id": "end_01",
        "type": "flow.end",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 400, "y": 180 }
      },
      {
        "id": "unknown_01",
        "type": "custom.unknown",
        "config": {},
        "bindings": {},
        "errorPolicy": "STOP",
        "editor": { "x": 400, "y": 350 }
      }
    ],
    "edges": [
      {
        "id": "edge_01",
        "sourceNodeId": "start_01",
        "sourcePort": "unknown_port",
        "targetNodeId": "end_01"
      }
    ]
  }
}
```

## 13. Authentication failure

Send the Valid minimum request without the `Authorization` header. Expected: HTTP `401`.

## 14. Generated limit cases

For each generated case, put this as the Postman raw body:

```text
{{generatedPayload}}
```

Then add the matching Pre-request Script.

### More than 500 nodes

Expected: HTTP `200`, `GRAPH_NODE_LIMIT_EXCEEDED`.

```javascript
const nodes = Array.from({ length: 501 }, (_, index) => ({
  id: `node_${index}`,
  type: 'flow.start',
  config: {},
  bindings: {},
  errorPolicy: 'STOP',
  editor: { x: index, y: 0 },
}));

pm.variables.set(
  'generatedPayload',
  JSON.stringify({
    editorGraph: {
      schemaVersion: 1,
      entryNodeId: 'node_0',
      nodes,
      edges: [],
    },
  }),
);
```

### More than 1,000 edges

Expected: HTTP `200`, `GRAPH_EDGE_LIMIT_EXCEEDED`.

```javascript
const edges = Array.from({ length: 1001 }, (_, index) => ({
  id: `edge_${index}`,
  sourceNodeId: 'start_01',
  sourcePort: 'success',
  targetNodeId: 'end_01',
}));

pm.variables.set(
  'generatedPayload',
  JSON.stringify({
    editorGraph: {
      schemaVersion: 1,
      entryNodeId: 'start_01',
      nodes: [
        {
          id: 'start_01',
          type: 'flow.start',
          config: {},
          bindings: {},
          errorPolicy: 'STOP',
          editor: { x: 0, y: 0 },
        },
        {
          id: 'end_01',
          type: 'flow.end',
          config: {},
          bindings: {},
          errorPolicy: 'STOP',
          editor: { x: 1, y: 0 },
        },
      ],
      edges,
    },
  }),
);
```

### More than 1 MiB

Expected: HTTP `413`, `Error.EditorGraphPayloadTooLarge`.

```javascript
pm.variables.set(
  'generatedPayload',
  JSON.stringify({
    editorGraph: {
      schemaVersion: 1,
      entryNodeId: 'start_01',
      nodes: [
        {
          id: 'start_01',
          type: 'flow.start',
          config: {},
          bindings: { padding: 'x'.repeat(1048576) },
          errorPolicy: 'STOP',
          editor: { x: 0, y: 0 },
        },
      ],
      edges: [],
    },
  }),
);
```

## 15. What these cases do not prove

- Android commands execute on a device.
- Binding values match node input schemas.
- Conditional, loop, retry, or error-flow completeness.
- Runtime IR compatibility or compilation.
- Submission processing and result persistence.

Those behaviors belong to later phases and require separate integration tests.
