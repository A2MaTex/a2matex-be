We can start immediately with the **Node Catalog foundation**, but not the API yet. The database and catalog contract must exist before the API has anything reliable to return.

One repository issue first: the Backend is currently on `feat/launcher-release`, with `AGENTS.md` and [studio_workflow_checklist.md](/home/dino/dev/a2matex/a2matex-be/studio_workflow_checklist.md) untracked. Studio Workflow work should begin on its own branch after the Launcher Release branch is accounted for.

## Recommended first implementation slice

### Slice 1 — Basic Node Catalog contract

Implement only the linear Android workflow nodes:

- `flow.start`
- `flow.end`
- `flow.delay`
- `utility.log`
- `android.launch_app`
- `android.tap`
- `android.swipe`
- `android.input_text`
- `android.press_back`
- `android.press_home`
- `android.screenshot`

Deliverables:

- Node type and category constants.
- Zod contract for a predefined node definition.
- Input/output/config JSON Schema envelope.
- Standard `success` and `error` ports.
- Runtime handler and minimum Runtime version fields.
- Capability codes.
- Version-controlled definition files for those nodes.
- Valid and invalid definition fixtures.
- Targeted contract tests.

We should defer `if`, `for`, `while`, and loop bindings until the linear graph works end-to-end. However, the contract should allow named ports so those nodes can be added without redesign.

No new dependency is required in this slice. Zod can validate the catalog envelope. Ajv can be proposed later when we need to validate arbitrary node configuration against embedded JSON Schema.

## Slice 2 — Catalog database migration

After reviewing Slice 1:

- Add `Capability`.
- Add `NodeDefinition`.
- Add immutable `NodeDefinitionVersion`.
- Add `NodeDefinitionCapability`.
- Use system publication metadata rather than requiring a normal user.
- Add constraints and indexes.
- Create only the forward SQL migration.
- Stop for you to apply it.
- After you apply it, introspect Prisma and generate the client.

## Slice 3 — Catalog publisher

After Prisma generation:

- Load the predefined definition files.
- Validate all definitions.
- Publish them transactionally.
- Make publication idempotent.
- Reject modification of an existing version.
- Log inserted/skipped definitions without logging entire schemas.

## Slice 4 — Studio Catalog API

Then implement:

```http
GET /node-catalog?runtimeVersion=0.1.0
```

It will return:

- Latest active compatible versions.
- Schemas, ports, capabilities, and editor hints.
- Deterministic catalog hash.
- ETag support.
- Exact pinned-version resolution for older drafts.

So the correct starting point is **Slice 1: the linear Node Catalog contract and its initial predefined nodes**. If you approve that scope, I can implement it with targeted contract tests and leave the database untouched until you review the resulting definitions.
