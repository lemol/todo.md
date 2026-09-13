---
title: Add sync, status, changes and overview to the hub
tags: [hub]
depends_on: [14]
---
## Goal

Finish the hub API: sync and its persisted status, the live `changes`
stream, cross-project `overview`, and qualified references. After this the
hub is everything the CLI (16), web app (17, 18), sources (19, 06) and TUI
(20) need.

Design: [hub design §3](../../docs/superpowers/specs/2026-09-13-hub-design.md#3-the-hub-api).

## Scope

In: `state.json`, `status`, `sync`, `syncAll`, `autoSync`, `changes`,
`fsSource.changes`, `overview`, `parseRef`/`formatRef`, `SyncError`,
`SyncFailure`.

Out: any real remote source (19, 06); frontends (16–18).

Already there from task 14: `SyncError` (`{ project, reason, message }`) and
`SyncOutcome` are declared, because `Source.sync` names them;
`memorySource(hooks)` accepts `sync`, `changes` and `status` hooks; sources
receive `FileSystem` and `Path` from the hub (`SourceEnv`). See
[`src/hub/README.md`](../../src/hub/README.md).

## Design

**State** (`<home>/projects/<name>/state.json`):
`{ version: 1, lastSync?, result, error?, diverged? }`, a `Schema` with
encode/decode; written atomically (tmp + rename). Missing → `{ result:
"never" }`. Unregistered projects have no state file; their status is
always `{ result: "never" }`.

**`status(name)`**: the persisted state merged with `source.status(p)` (for
example git's live `ahead`/`behind`). A failing `source.status` is ignored
(logged at debug) so status never fails for a registered project.
`projects()` includes each project's status.

**`sync(name)`**:

- Sources without `sync`: succeed with `{ summary: "nothing to sync" }`,
  write nothing.
- Otherwise run `source.sync(p)` behind a per-project `Semaphore` (one
  sync per project per process). On success write `{ lastSync: now,
  result: "ok" }` (and `diverged: false`); on `SyncError` write
  `{ lastSync: now, result: "error", error: message, diverged: reason ===
  "diverged" }` and fail.
- After either, invalidate nothing (layers read the replica), and publish
  `{ kind: "synced", project }`.
- `SyncResult`: `{ project, summary, ahead?, behind?, at }`.

**`syncAll()`**: every registered syncable project, concurrency 4, each
result or `SyncFailure { project, error }`; never fails.

**`autoSync`** (`Hub.layer` option, a `Duration`, default off): a scoped
fiber forked in the layer that runs `syncAll` on that interval, starting
one interval after startup. It ends with the layer's scope.

**`changes: Stream<HubChange>`**:

- Backed by a `PubSub`. Watchers are reference-counted: the first
  subscriber starts them, the last one leaving stops them, so a CLI that
  never consumes `changes` never watches anything.
- While running, for every registered project whose source has `changes`
  (plus unregistered projects opened in this hub) run `source.changes(p)`
  and publish `{ kind: "changed", project }` per emission. When the
  registry changes, re-evaluate which watchers run.
- Watch `<home>/projects.yaml` (its directory, filtered to that file,
  debounced 100 ms) and publish `{ kind: "registry" }`; also publish it
  after this hub's own registry writes.
- After a successful mutation through `hub.todo(name)` on a project whose
  source has **no** `changes`, publish `{ kind: "changed", project }`.
  Implement by wrapping the store (or service) in the `LayerMap` layer.
- Watcher failures (for example a deleted directory) end that project's
  watcher and log; they never fail the stream.

**`fsSource.changes`**: `FileSystem.watch(root, { recursive: true })`,
ignoring events whose basename is `.todo.lock` or ends in `.tmp`,
debounced 100 ms (`Stream.debounce`), mapped to `void`. This is the Effect
version of `apps/web/watch.ts`; task 17 deletes the web copy. Export the
building block as `watchList(root)` so the git source can watch its clone.

**`overview({ projects?, sources?, filter? })`**:

- Projects: the given names (unknown ones become error entries with
  `ProjectNotFound`), else every registered project, in registry order;
  filtered by `sources`.
- For each, concurrency 4: `hub.todo(name)` then `list(filter)`. Success →
  `{ project, listing }`; any failure → `{ project, error }`.
- `tasks`: for each successful listing, in project order, every task view
  in priority order (sections flattened, then done tasks if the filter asks
  for them), as `{ project, ref: formatRef(project, id), view }`.

**Refs** (`src/hub/refs.ts`): `formatRef(project, id)` = `project:id`;
`parseRef(text)` = `{ project, id }` when `text` has a `:` whose left side
is a valid project name, otherwise `{ id: text }`. IDs are passed through
unchanged (the CLI still strips leading zeros for fs IDs).

**`SyncError`**: `{ project, reason: "offline" | "auth" | "rejected" |
"diverged" | "remote", message }`.

## Files

- `src/hub/state.ts`, `sync.ts`, `changes.ts`, `overview.ts`, `refs.ts`,
  `errors.ts`, `Hub.ts`, `sources/fs.ts`, `testing.ts` (memorySource gets
  configurable `sync`/`changes`/`status` hooks), `README.md`
- `test/hub/*.test.ts`

## Tests

- State: sync success and failure persist; status merges source status;
  a failing `source.status` doesn't fail `status`.
- Two concurrent `sync(name)` calls in one hub run one after the other.
- `syncAll` with one failing project returns the others' results.
- `autoSync` with `TestClock`: advancing the interval triggers a sync.
- `changes`: a memorySource emission → `changed`; a registry edit from a
  second hub over the same home → `registry`; a mutation through `todo()`
  on a source without `changes` → `changed`; no subscriber → the memory
  source's `changes` is never started.
- `fsSource.changes`: port the scenarios of `apps/web/test/watch.test.ts`
  (writing a task file fires one debounced event; `.todo.lock` and `*.tmp`
  fire none). The web version is flaky under full-suite load (it failed
  once in `bun run check` on 2026-09-13 and passed alone): wait for the
  event with a generous timeout instead of a fixed sleep, and assert "no
  event" over a window long enough for the debounce.
- `overview`: filter applied per project; an erroring project doesn't hide
  the rest; unknown names become error entries; `tasks` order and refs.
- `parseRef`/`formatRef` round trip, including Jira-style IDs
  (`work:PROJ-7`) and plain IDs.

## Docs

- `src/hub/README.md`; `docs/architecture/hub.md` loses its "planned"
  banner and describes the built API.

## Done when

- The hub API matches the design (or the design and docs are updated where
  implementation taught us better).
- `bun run check` passes.
