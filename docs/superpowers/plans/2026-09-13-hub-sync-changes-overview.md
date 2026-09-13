# Hub Sync, Changes and Overview Implementation Plan (task 15)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the hub API: persisted sync status (`state.json`), `status`, `sync`, `syncAll`, `autoSync`, the lazy `changes` stream (with `fsSource.changes`), cross-project `overview`, and qualified references (`parseRef`/`formatRef`).

**Architecture:**
- **State** is `<home>/projects/<name>/state.json`, a versioned `Schema` written atomically. `statusOf(project)` overlays it with the source's live `status` fields. `projects()`, `add`, `rename`, `resolve` and `status` all report it.
- **Sync** runs `source.sync` behind a per-project `Semaphore`, records the outcome in `state.json`, and publishes `synced`. `syncAll` fans out over syncable projects (concurrency 4). `autoSync` is a scoped fiber in the hub layer.
- **Changes** is a `PubSub<HubChange>` exposed as a `Stream`. The watchers (one fiber per watched project in a `FiberMap`, plus a watch on `projects.yaml`) live in an `RcRef`: the first subscriber acquires them, the last one leaving releases them. Stores of sources without `changes` are wrapped so the hub's own mutations publish `changed`.
- **Overview** runs `list(filter)` per project (concurrency 4) and flattens tasks with qualified refs.

**Tech Stack:** Bun 1.4, TypeScript 7, Effect `4.0.0-rc.108` (`PubSub`, `RcRef`, `FiberMap`, `Semaphore`, `Stream`, `Schema`, `DateTime`, `LayerMap`), `@effect/platform-bun` (tests only), `bun:test`, Biome.

**Spec:**
- [`todo/hub-and-sources/15-add-sync-status-changes-and-overview-to-the-hub.md`](../../../todo/hub-and-sources/) (`bun src/cli/bin.ts show 15`): the task, its design details, tests and acceptance criteria. **Read it first.**
- [Hub design](../specs/2026-09-13-hub-design.md) §3 (the hub API) and §4 (sources).
- [`src/hub/README.md`](../../../src/hub/README.md): what task 14 built.
- [`docs/architecture/hub.md`](../../architecture/hub.md), [`sources.md`](../../architecture/sources.md): the living reference Task 7 updates.

## Global Constraints

- **Read the Effect guide first.** Before writing Effect code, read `node_modules/effect/AGENTS.md` completely. Services are yielded (`yield* FileSystem.FileSystem`).
- **Imports.** `src/hub/**` may import only its own files, `../spec/index.ts`, `../core/index.ts`, `../fs/index.ts`, `effect` and `yaml`. No `node:*`, no `bun`, no `@effect/platform-bun`. Only tests may import `src/hub/testing.ts`. `test/boundaries.test.ts` enforces this.
- **Relative module imports.** Modules import each other through `../<module>/index.ts`, never `@lemol/todo-md/...`.
- **No frontend changes.** The CLI and the web app keep working exactly as today (tasks 16–18 wire them). Do not touch `apps/web`.
- **Strict TypeScript.** `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on: never assign `undefined` to an optional property; build objects conditionally.
- **Tests.** `bun:test` plus `effectTest` from `src/spec/testing.ts`, which runs on Effect's `TestClock` (time starts at 0 and only moves with `TestClock.adjust`). Anything that waits on a real file watch, a debounce or a real sleep uses `liveTest` (added in Task 3), on the real clock. No fixed sleeps to wait for a watcher: retry the action until the event arrives (`eventually`), with generous bounds. No test touches the real `~/.todo-md` or the network.
- **Formatting.** Biome: double quotes, no semicolons, 2-space indent, width 100. Run `bun run fix` after editing; the code below is close to formatted but let Biome have the last word.
- **Gate.** `bun run check` (lint + typecheck + all tests) must pass before every commit.
- **Branch.** Work on `main`; do not create a branch or worktree.
- **Commits.** Plain sentences, ending with the attribution trailer your session gives, for example:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JAbSVu93PGiq8VsggEEchV
  ```

## Decisions this plan makes

The task leaves these open or needs them sharpened. Task 7 records them in the docs.

1. **Wider error unions than the design's sketch**, like task 14's: `status` can also fail with `RegistryError`; `sync` with `InvalidProjectConfig`, `SourceUnavailable` and `RegistryError`; `syncAll` fails only with `RegistryError` (an unreadable registry), never for a project. `overview`'s query is optional.
2. **Stale services after another process edits the registry** (task 14's review): `todo(name)` now looks the project up on every call and compares a fingerprint of its entry with the one its cached service was built from; on a difference it invalidates the `LayerMap` key first. This works without any watcher (the CLI never watches). While `changes` runs, a change to `projects.yaml` also invalidates every cached service whose entry changed or disappeared, so their scopes close promptly in long-running hosts.
3. **`state.json` never fails a status.** Missing → `{ result: "never" }`; unreadable or invalid → `{ result: "error", error: "could not read …" }`. Writing it creates the data directory if needed (a hand-written entry has none); a failed write is logged and does not change the sync's outcome.
4. **`sync` on a source without `sync`** returns `{ summary: "nothing to sync" }`, writes nothing and publishes nothing.
5. **`overview` defaults to registered projects only.** Named projects may include unregistered ones opened in this hub. An unknown name becomes an entry whose `project` is a placeholder `ProjectInfo` (`source: ""`, `location: ""`, `registered: false`, error status) and whose `error` is `ProjectNotFound`; the `sources` filter never drops unknown names.
6. **`registry` events may repeat:** the hub publishes one after its own write, and its file watch may report the same write. Consumers treat every event as "re-read".
7. **The registry watch creates `<home>`** on the first subscription, because a missing directory cannot be watched.
8. **An ended watcher stays ended** (for example a missing list) until its project's entry changes; it is logged at warning level.
9. **`memorySource` accepts a `kind` hook**, so a test can load two memory sources side by side.
10. **`lockFile` is exported from `fs`**, so `watchList` ignores the lock by name instead of repeating `.todo.lock`.
11. **`SyncResult` and `SyncFailure` are plain interfaces.** Tell them apart with `"error" in outcome`.
12. **`parseRef` splits at the first `:`** and requires a non-empty ID, so `a:b:c` is project `a`, ID `b:c`, and `work:` stays a plain ID.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/hub/refs.ts` (new) | `TaskRef`, `formatRef`, `parseRef`. |
| `src/hub/state.ts` (new) | `SyncState` schema, `readState`, `writeState`, `statusOf`. |
| `src/hub/sync.ts` (new) | `SyncResult`, `SyncFailure`, `makeSyncer` (per-project semaphore, state writes, `synced`). |
| `src/hub/changes.ts` (new) | `HubChange`, `Watched`, `makeChanges` (PubSub, ref-counted watchers, registry watch), `notifying`. |
| `src/hub/overview.ts` (new) | `OverviewQuery`, `Overview`, `OverviewEntry`, `OverviewTask`, `OverviewError`, `overviewOf`, `tasksOf`. |
| `src/hub/projects.ts` | `infoOf(project, status)`; new `fingerprintOf`. |
| `src/hub/Hub.ts` | Wiring: `status`, `sync`, `syncAll`, `autoSync`, `overview`, `changes`, fingerprinted `todo`. |
| `src/hub/sources/fs.ts` | `watchList(root)`, `fsSource.changes`. |
| `src/hub/testing.ts` | `kind` hook. |
| `src/hub/index.ts` | New exports. |
| `src/hub/Source.ts`, `src/hub/errors.ts` | Doc comments only (Task 7). |
| `src/fs/index.ts`, `src/fs/README.md` | Export and document `lockFile`. |
| `test/hub/helpers.ts` | `liveTest`, `takeWithin`, `eventually`, `makeWatchers`, `listen`; `hubOn` options. |
| `test/hub/refs.test.ts`, `status.test.ts`, `changes.test.ts`, `sync.test.ts`, `overview.test.ts` (new) | Tests per area. |
| `test/hub/fs.test.ts`, `Hub.test.ts`, `testing.test.ts`, `index.test.ts` | Extended. |
| `src/hub/README.md`, `docs/architecture/hub.md`, `docs/architecture/sources.md` | Docs (Task 7). |

---

### Task 1: Qualified references

**Files:**
- Create: `src/hub/refs.ts`
- Modify: `src/hub/index.ts`
- Test: `test/hub/refs.test.ts`, `test/hub/index.test.ts`

**Interfaces:**
- Consumes: `isValidName(name: string): boolean` from `src/hub/names.ts`.
- Produces: `interface TaskRef { readonly project?: string; readonly id: string }`, `formatRef(project: string, id: string): string`, `parseRef(text: string): TaskRef`. Task 6 uses `formatRef`.

- [ ] **Step 1: Write the failing test**

Create `test/hub/refs.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { formatRef, parseRef } from "../../src/hub/index.ts"

describe("refs", () => {
  test("formats project:id", () => {
    expect(formatRef("todo-md", "12")).toBe("todo-md:12")
    expect(formatRef("work", "PROJ-7")).toBe("work:PROJ-7")
  })

  test("parses a qualified reference at its first colon", () => {
    expect(parseRef("todo-md:12")).toEqual({ project: "todo-md", id: "12" })
    expect(parseRef("work:PROJ-7")).toEqual({ project: "work", id: "PROJ-7" })
    expect(parseRef("a:b:c")).toEqual({ project: "a", id: "b:c" })
  })

  test("keeps plain IDs whole and unchanged", () => {
    expect(parseRef("12")).toEqual({ id: "12" })
    expect(parseRef("007")).toEqual({ id: "007" })
    expect(parseRef("PROJ-7")).toEqual({ id: "PROJ-7" })
  })

  test("treats text without a valid project name or ID as a plain ID", () => {
    expect(parseRef("My App:1")).toEqual({ id: "My App:1" })
    expect(parseRef(":1")).toEqual({ id: ":1" })
    expect(parseRef("work:")).toEqual({ id: "work:" })
  })

  test("round-trips", () => {
    for (const [project, id] of [
      ["todo-md", "12"],
      ["work", "PROJ-7"],
      ["a", "b:c"],
    ] as const) {
      expect(parseRef(formatRef(project, id))).toEqual({ project, id })
    }
  })
})
```

In `test/hub/index.test.ts`, add `"formatRef"` and `"parseRef"` to the list of names after `"isValidName"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/hub/refs.test.ts test/hub/index.test.ts`
Expected: FAIL (`formatRef` is not exported).

- [ ] **Step 3: Implement**

Create `src/hub/refs.ts`:

```ts
import { isValidName } from "./names.ts"

/** A task reference as typed: `<project>:<id>`, or a bare ID in the current project. */
export interface TaskRef {
  readonly project?: string
  readonly id: string
}

/** `<project>:<id>`, e.g. `todo-md:12` or `work:PROJ-7`. */
export const formatRef = (project: string, id: string): string => `${project}:${id}`

/**
 * Splits `text` at its first `:` when the left side is a valid project name
 * and the right side is not empty; otherwise all of `text` is the ID. IDs are
 * returned unchanged (callers normalize them, e.g. fs's leading zeros).
 */
export const parseRef = (text: string): TaskRef => {
  const colon = text.indexOf(":")
  const project = text.slice(0, colon)
  const id = text.slice(colon + 1)
  return colon > 0 && isValidName(project) && id !== "" ? { project, id } : { id: text }
}
```

In `src/hub/index.ts`, after the `isValidName` export line, add:

```ts
export { formatRef, parseRef, type TaskRef } from "./refs.ts"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/hub/refs.test.ts test/hub/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
bun run fix && bun run check
git add src/hub/refs.ts src/hub/index.ts test/hub/refs.test.ts test/hub/index.test.ts
git commit -m "Add qualified task references to the hub"
```

---

### Task 2: Persisted state and `status`

**Files:**
- Create: `src/hub/state.ts`
- Modify: `src/hub/projects.ts` (`infoOf`), `src/hub/Hub.ts`
- Test: `test/hub/status.test.ts`

**Interfaces:**
- Consumes: `Project`, `sourceProjectOf` (`src/hub/projects.ts`); `ProjectStatus`, `SourceEnv` (`src/hub/Source.ts`).
- Produces:
  - `SyncState` (Schema) and `type SyncState = { version: 1; lastSync?: DateTime.Utc; result: "ok" | "error" | "never"; error?: string; diverged?: boolean }`.
  - `readState(dir: string | undefined): Effect<ProjectStatus, never, SourceEnv>`.
  - `writeState(dir: string, state: Omit<SyncState, "version">): Effect<void, PlatformError | SchemaError, SourceEnv>`. Task 5 uses it.
  - `statusOf(project: Project): Effect<ProjectStatus, never, SourceEnv>`.
  - `infoOf(project: Project, status: ProjectStatus): ProjectInfo` (signature change).
  - In `Hub.ts`: a local `describe(project: Project): Effect<ProjectInfo>`, used by later tasks; `Hub.status(name): Effect<ProjectStatus, ProjectNotFound | RegistryError>`.

- [ ] **Step 1: Write the failing tests**

Create `test/hub/status.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import { fsSource, type ProjectStatus } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, hubOn, md } from "./helpers.ts"

/** `status` with `lastSync` as an ISO string, for comparisons. */
const plain = (status: ProjectStatus) => ({
  ...status,
  lastSync: status.lastSync === undefined ? undefined : DateTime.formatIso(status.lastSync),
})

const registry = { ".todo-md/projects.yaml": md("projects:", "  m:", "    source: memory") }

const stateJson = JSON.stringify({
  version: 1,
  lastSync: "2026-09-13T10:00:00.000Z",
  result: "error",
  error: "rebase conflict",
  diverged: true,
})

describe("status", () => {
  effectTest(
    "is never for a project that has not synced",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect(yield* hub.status("m")).toEqual({ result: "never" })
    }),
    diskWith(registry),
  )

  effectTest(
    "reads the project's state.json",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect(plain(yield* hub.status("m"))).toEqual({
        lastSync: "2026-09-13T10:00:00.000Z",
        result: "error",
        error: "rebase conflict",
        diverged: true,
      })
    }),
    diskWith({ ...registry, ".todo-md/projects/m/state.json": stateJson }),
  )

  effectTest(
    "overlays the source's live fields",
    Effect.gen(function* () {
      const hub = yield* hubOn([
        memorySource({ status: () => Effect.succeed({ ahead: 2, behind: 1 }) }),
      ])
      expect(plain(yield* hub.status("m"))).toEqual({
        lastSync: "2026-09-13T10:00:00.000Z",
        result: "error",
        error: "rebase conflict",
        diverged: true,
        ahead: 2,
        behind: 1,
      })
    }),
    diskWith({ ...registry, ".todo-md/projects/m/state.json": stateJson }),
  )

  effectTest(
    "leaves out a failing source status",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource({ status: () => Effect.die(new Error("no git")) })])
      expect(yield* hub.status("m")).toEqual({ result: "never" })
    }),
    diskWith(registry),
  )

  effectTest(
    "reports an unreadable state.json as an error status",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([memorySource()])
      const status = yield* hub.status("m")
      expect(status.result).toBe("error")
      expect(status.error).toContain(`could not read ${root}/.todo-md/projects/m/state.json`)
    }),
    diskWith({ ...registry, ".todo-md/projects/m/state.json": "{" }),
  )

  effectTest(
    "is never for an unregistered project",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])
      const info = yield* hub.resolve({ dir: "app", cwd: root })
      expect(info.status).toEqual({ result: "never" })
      expect(yield* hub.status(info.name)).toEqual({ result: "never" })
    }),
    diskWith({ "app/TODO.md": md("# App") }),
  )

  effectTest(
    "fails with ProjectNotFound for an unknown name",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect((yield* Effect.flip(hub.status("nope")))._tag).toBe("ProjectNotFound")
    }),
    diskWith(registry),
  )

  effectTest(
    "is part of every project in projects()",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      const [project] = yield* hub.projects()
      expect(project?.status.result).toBe("error")
      expect(project?.status.diverged).toBe(true)
    }),
    diskWith({ ...registry, ".todo-md/projects/m/state.json": stateJson }),
  )
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/hub/status.test.ts`
Expected: FAIL (`hub.status` is not a function; the state file is ignored).

- [ ] **Step 3: Create `src/hub/state.ts`**

```ts
/**
 * `<home>/projects/<name>/state.json`: the outcome of a project's last sync.
 * The hub owns this file; sources keep their own files next to it.
 */

import { Effect, FileSystem, Path, Random, Schema } from "effect"
import { type Project, sourceProjectOf } from "./projects.ts"
import type { ProjectStatus, SourceEnv } from "./Source.ts"

export const stateFile = "state.json"

export const SyncState = Schema.Struct({
  version: Schema.Literal(1),
  lastSync: Schema.optionalKey(Schema.DateTimeUtcFromString),
  result: Schema.Literals(["ok", "error", "never"]),
  error: Schema.optionalKey(Schema.String),
  diverged: Schema.optionalKey(Schema.Boolean),
})
export type SyncState = typeof SyncState.Type

const StateJson = Schema.fromJsonString(SyncState)

const never: ProjectStatus = { result: "never" }

/** The status in `<dir>/state.json`: `never` without a file (or a `dir`), `error` when unreadable. */
export const readState = (dir: string | undefined): Effect.Effect<ProjectStatus, never, SourceEnv> =>
  Effect.gen(function* () {
    if (dir === undefined) return never
    const fs = yield* FileSystem.FileSystem
    const file = (yield* Path.Path).join(dir, stateFile)
    return yield* fs.readFileString(file).pipe(
      Effect.flatMap((text) => Schema.decodeUnknownEffect(StateJson)(text)),
      Effect.map(({ version: _version, ...status }): ProjectStatus => status),
      Effect.catch((error) =>
        Effect.succeed<ProjectStatus>(
          error._tag === "PlatformError" && error.reason._tag === "NotFound"
            ? never
            : { result: "error", error: `could not read ${file}: ${error.message}` },
        ),
      ),
    )
  })

/** Replaces `<dir>/state.json` atomically, creating `dir` if needed. */
export const writeState = (dir: string, state: Omit<SyncState, "version">) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = (yield* Path.Path).join(dir, stateFile)
    const encoded = yield* Schema.encodeEffect(SyncState)({ version: 1, ...state })
    const token = yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER)
    const temporary = `${file}.${token.toString(36)}.tmp`
    yield* fs.makeDirectory(dir, { recursive: true })
    yield* fs
      .writeFileString(temporary, `${JSON.stringify(encoded, null, 2)}\n`)
      .pipe(
        Effect.andThen(fs.rename(temporary, file)),
        Effect.onError(() => Effect.ignore(fs.remove(temporary))),
      )
  })

/**
 * A project's status: its state file, overlaid with the source's live fields
 * (such as git's `ahead`). A failing `source.status` is logged and left out;
 * a broken entry's status is its problem.
 */
export const statusOf = (project: Project): Effect.Effect<ProjectStatus, never, SourceEnv> =>
  Effect.gen(function* () {
    const { config } = project
    if (config._tag === "Invalid") {
      return { result: "error" as const, error: config.problem.message }
    }
    const persisted = yield* readState(project.dir)
    if (config.source.status === undefined) return persisted
    const live = yield* config.source.status(sourceProjectOf(project, config.value)).pipe(
      Effect.catchDefect((defect) =>
        Effect.as(Effect.logDebug(`could not read the live status of ${project.name}`, defect), {}),
      ),
    )
    return { ...persisted, ...live }
  })
```

If TypeScript rejects `error._tag === "PlatformError"` because the union's members lack a common `_tag`, narrow with `PlatformError.isPlatformError(error)` if it exists in `effect/PlatformError`, else `error instanceof PlatformError.PlatformError`.

- [ ] **Step 4: Change `infoOf` in `src/hub/projects.ts`**

Add `ProjectStatus` to the type import from `./Source.ts`, and replace `infoOf` with:

```ts
export const infoOf = (project: Project, status: ProjectStatus): ProjectInfo => {
  const { config } = project
  if (config._tag === "Invalid") {
    return {
      name: project.name,
      source: project.kind,
      location: "",
      registered: project.registered,
      syncable: false,
      status,
    }
  }
  return {
    name: project.name,
    source: project.kind,
    location: config.source.location(config.value),
    registered: project.registered,
    syncable: config.source.sync !== undefined,
    status,
  }
}
```

- [ ] **Step 5: Wire `status` and `describe` into `src/hub/Hub.ts`**

1. Imports: change `import type { AnySource, ProjectInfo, SourceEnv } from "./Source.ts"` to also import `ProjectStatus`, and add `import { statusOf } from "./state.ts"`.
2. In the service interface, after `todo(…)`, add:

   ```ts
    /** The last sync (`state.json`), overlaid with the source's live fields. Never fails for a found project. */
    status(name: string): Effect.Effect<ProjectStatus, ProjectNotFound | RegistryError>
   ```

3. In `make`, right after the `find` function, add:

   ```ts
    const describe = (project: Project): Effect.Effect<ProjectInfo> =>
      Effect.map(inEnv(statusOf(project)), (status) => infoOf(project, status))
   ```

4. `projects:` becomes:

   ```ts
      projects: () =>
        Effect.flatMap(registered, (projects) =>
          Effect.forEach([...projects, ...unregistered.all()], describe, { concurrency: 4 }),
        ),
   ```

5. In `add`, replace `return infoOf({ … })` with `return yield* describe({ … })` (same object).
6. In `rename`, replace `return infoOf(yield* find(to))` with `return yield* describe(yield* find(to))`.
7. `resolve:` becomes:

   ```ts
      resolve: (at) =>
        inEnv(resolveProject(at, { registered, find, unregistered })).pipe(
          Effect.flatMap(describe),
        ),
   ```

8. After `todo:`, add:

   ```ts
      status: (name) => Effect.flatMap(find(name), (project) => inEnv(statusOf(project))),
   ```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test test/hub`
Expected: PASS, including the existing `Hub.test.ts` (broken entries still show their error status; fresh projects show `never`).

- [ ] **Step 7: Gate and commit**

```bash
bun run fix && bun run check
git add src/hub/state.ts src/hub/projects.ts src/hub/Hub.ts test/hub/status.test.ts
git commit -m "Persist sync state and report project status in the hub"
```

---

### Task 3: `watchList` and `fsSource.changes`

**Files:**
- Modify: `src/fs/index.ts`, `src/fs/README.md`, `src/hub/sources/fs.ts`, `src/hub/index.ts`, `test/hub/helpers.ts`
- Test: `test/hub/fs.test.ts`

**Interfaces:**
- Consumes: `lockFile` (`".todo.lock"`, `src/fs/lock.ts`), `listRootOf(path)` (`src/hub/sources/fs.ts`).
- Produces:
  - `watchList(root: string): Stream<void, PlatformError, SourceEnv>`, exported from the hub (the git source reuses it).
  - `fsSource.changes(project): Stream<void, never, SourceEnv>`.
  - Test helpers in `test/hub/helpers.ts`: `liveTest(name, effect, disk)`, `takeWithin(queue, within): Effect<Option<A>>`, `eventually(action, check, attempts?): Effect<Option<A>>`. Tasks 4–5 use them.

- [ ] **Step 1: Export `lockFile` from fs**

In `src/fs/index.ts`, change the lock line to:

```ts
export { defaultLockOptions, type Lock, type LockOptions, lockFile, makeLock } from "./lock.ts"
```

In `src/fs/README.md`, change the `makeLock` row's first cell to `` `makeLock(root, options?)`, `Lock`, `defaultLockOptions`, `lockFile` `` and add to its text: "`lockFile` is the name, for watchers that ignore it."

- [ ] **Step 2: Add the real-clock helpers to `test/hub/helpers.ts`**

Extend the imports (`test` from `bun:test`; `Duration`, `Option`, `Queue` from `effect`) and append:

```ts
/** Like `effectTest`, but on the real clock: for file watches, debounces and real sleeps. */
export const liveTest = <A, E>(
  name: string,
  effect: Effect.Effect<A, E, Disk | Scope.Scope>,
  disk: Layer.Layer<Disk>,
) => test(name, () => Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(disk))), 30_000)

/** The next item of `queue` within `within`, or none. */
export const takeWithin = <A>(queue: Queue.Dequeue<A>, within: Duration.Input) =>
  Effect.timeoutOption(Queue.take(queue), within)

/**
 * Runs `action` then `check` until `check` finds something, up to `attempts`
 * times. File watches start asynchronously, so a test repeats the change that
 * should be seen instead of sleeping and hoping the watch is ready. `action`
 * is run as given each time: wrap it in `Effect.suspend` to vary it.
 */
export const eventually = <A, E, R>(
  action: Effect.Effect<unknown, E, R>,
  check: Effect.Effect<Option.Option<A>, E, R>,
  attempts = 25,
): Effect.Effect<Option.Option<A>, E, R> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < attempts; attempt++) {
      yield* action
      const found = yield* check
      if (Option.isSome(found)) return found
    }
    return Option.none()
  })
```

(`Layer` and `Scope` are already imported there; add `type` modifiers where Biome asks.)

- [ ] **Step 3: Write the failing tests**

Append to `test/hub/fs.test.ts` (extend the imports: `Duration`, `Exit`, `Option`, `Queue`, `Stream` from `effect`; `effectTest` is already imported; `eventually`, `liveTest`, `takeWithin` from `./helpers.ts`):

```ts
describe("fsSource.changes", () => {
  const changesOf = (path: string) =>
    fsSource.changes?.({ name: "app", config: { path }, dir: undefined }) ?? Stream.empty

  liveTest(
    "emits once per burst of writes and ignores the lock and temporary files",
    Effect.gen(function* () {
      const disk = yield* Disk
      const events = yield* Queue.unbounded<void>()
      yield* changesOf(disk.root).pipe(
        Stream.runForEach(() => Queue.offer(events, undefined)),
        Effect.provide(BunServices.layer),
        Effect.forkScoped,
      )
      const fired = (within: Duration.Input) => Effect.map(takeWithin(events, within), Option.isSome)
      // Arm: touch a probe file until the watch reports it, then let it settle.
      let probes = 0
      const armed = yield* eventually(
        Effect.suspend(() => disk.write("probe.md", String(probes++))),
        takeWithin(events, "200 millis"),
      )
      expect(Option.isSome(armed)).toBe(true)
      let settling = true
      while (settling) settling = yield* fired("300 millis")

      yield* disk.write("tasks/01-one.md", "one")
      yield* disk.write("tasks/01-one.md", "two")
      expect(yield* fired("5 seconds")).toBe(true)
      expect(yield* fired("500 millis")).toBe(false)

      yield* disk.write(".todo.lock", "lock")
      yield* disk.write("ignored.tmp", "temp")
      expect(yield* fired("500 millis")).toBe(false)
    }),
    diskWith({ "TODO.md": md("# App") }),
  )

  effectTest(
    "ends without failing when there is no list",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const exit = yield* Effect.exit(
        changesOf(`${root}/gone`).pipe(Stream.runDrain, Effect.provide(BunServices.layer)),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
    diskWith({}),
  )
})
```

Also add `"watchList"` to the export list in `test/hub/index.test.ts`.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun test test/hub/fs.test.ts test/hub/index.test.ts`
Expected: FAIL (no events: `fsSource.changes` is undefined, so `changesOf` is `Stream.empty`; `watchList` is not exported).

- [ ] **Step 5: Implement in `src/hub/sources/fs.ts`**

Imports become:

```ts
import { Effect, FileSystem, Layer, Option, Path, type PlatformError, Schema, Stream } from "effect"
import { FsTodoStore, lockFile } from "../../fs/index.ts"
import { SourceError } from "../errors.ts"
import { nameForList } from "../names.ts"
import type { Source, SourceEnv, SourceProject } from "../Source.ts"
```

Add after `listRootOf`:

```ts
/**
 * Emits once each burst of changes under `root` settles (100 ms), ignoring
 * the lock file and temporary files. Fails when `root` cannot be watched.
 */
export const watchList = (
  root: string,
): Stream.Stream<void, PlatformError.PlatformError, SourceEnv> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      // Event paths may be relative to `root`; only the file name matters.
      return fs.watch(root, { recursive: true }).pipe(
        Stream.filter((event) => {
          const name = path.basename(event.path)
          return name !== lockFile && !name.endsWith(".tmp")
        }),
        Stream.debounce("100 millis"),
        Stream.map(() => undefined),
      )
    }),
  )

/** The list's changes; a missing or unwatchable list ends the stream with a warning. */
const changesOf = (project: SourceProject<FsConfig>): Stream.Stream<void, never, SourceEnv> => {
  const stop = (reason: string) =>
    Stream.drain(Stream.fromEffect(Effect.logWarning(`stopped watching ${project.name}: ${reason}`)))
  return Stream.unwrap(
    Effect.gen(function* () {
      const root = yield* listRootOf(project.config.path)
      const changes: Stream.Stream<void, PlatformError.PlatformError, SourceEnv> = Option.isSome(root)
        ? watchList(root.value)
        : stop(`no TODO.md at ${project.config.path}`)
      return changes
    }),
  ).pipe(Stream.catch((error) => stop(error.message)))
}
```

In `fsSource`, after `open`, add:

```ts
  changes: changesOf,
```

In `src/hub/index.ts`, change the fs line to:

```ts
export { FsConfig, fsSource, watchList } from "./sources/fs.ts"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test test/hub/fs.test.ts test/hub/index.test.ts`, then run `bun test test/hub/fs.test.ts` five times in a row.
Expected: PASS every time.

- [ ] **Step 7: Gate and commit**

```bash
bun run fix && bun run check
git add src/fs/index.ts src/fs/README.md src/hub/sources/fs.ts src/hub/index.ts test/hub/helpers.ts test/hub/fs.test.ts test/hub/index.test.ts
git commit -m "Watch fs lists for changes in the hub"
```

---

### Task 4: The `changes` stream

**Files:**
- Create: `src/hub/changes.ts`
- Modify: `src/hub/testing.ts`, `src/hub/projects.ts`, `src/hub/Hub.ts`, `src/hub/index.ts`, `test/hub/helpers.ts`
- Test: `test/hub/changes.test.ts`, `test/hub/Hub.test.ts`, `test/hub/testing.test.ts`

**Interfaces:**
- Consumes: `registryFile` (`src/hub/registry.ts`), `TodoStore` (`src/spec/index.ts`), `Project`, `sourceProjectOf`, `SourceEnv`, `RegistryError`; `describe` from Task 2; `takeWithin`, `eventually`, `liveTest` from Task 3.
- Produces:
  - `type HubChange = { readonly kind: "changed" | "synced"; readonly project: string } | { readonly kind: "registry" }`.
  - `interface Watched { readonly name: string; readonly key: string; readonly changes: Stream<void, never, SourceEnv> }`.
  - `makeChanges(options: { home; watched: Effect<ReadonlyArray<Watched>, RegistryError>; onRegistryFile: Effect<void> }): Effect<Changes, never, Scope | SourceEnv>` where `Changes = { stream: Stream<HubChange>; publish(change): Effect<void>; reconcile: Effect<void> }`. Task 5 calls `changes.publish`.
  - `notifying(store, notify): TodoStore["Service"]`.
  - `fingerprintOf(project: Project): string` (`src/hub/projects.ts`).
  - In `Hub.ts`: `serviceOf(project): Effect<TodoService["Service"], …>` (Task 6 uses it), `forget(name)`, `Hub.changes: Stream<HubChange>`.
  - `MemoryHooks` gains `kind`.
  - Test helpers: `makeWatchers: Effect<Watchers>` and `listen(hub, started)`.

- [ ] **Step 1: `kind` hook for `memorySource`**

In `src/hub/testing.ts`, add `"kind"` to the `Pick` in `MemoryHooks`:

```ts
export type MemoryHooks = Partial<
  Pick<
    Source<MemoryConfig>,
    "kind" | "defaultName" | "prepare" | "sync" | "changes" | "status" | "beforeRemove" | "owns"
  >
>
```

(`...hooks` already comes last in the returned object, so a `kind` hook wins.) Update the doc comment of `memorySource`: "`hooks` add behavior; `kind` renames the source, so a test can load two." In `test/hub/testing.test.ts`, in "adds the hooks it is given", add `expect(memorySource({ kind: "probe" }).kind).toBe("probe")`.

- [ ] **Step 2: Add the watcher helpers to `test/hub/helpers.ts`**

Add imports: `PubSub`, `Stream` from `effect`; `type HubChange` from `../../src/hub/index.ts` (exported in Step 6); `type MemoryHooks` from `../../src/hub/testing.ts`. Append:

```ts
/** A `changes` hook for `memorySource` that reports watcher starts and stops and emits on demand. */
export interface Watchers {
  /** Project names, as their watchers start. */
  readonly started: Queue.Queue<string>
  /** Project names, as their watchers stop. */
  readonly stopped: Queue.Queue<string>
  /** Makes project `name`'s watcher emit once. */
  emit(name: string): Effect.Effect<void>
  readonly changes: NonNullable<MemoryHooks["changes"]>
}

export const makeWatchers: Effect.Effect<Watchers> = Effect.gen(function* () {
  const started = yield* Queue.unbounded<string>()
  const stopped = yield* Queue.unbounded<string>()
  const emitted = yield* PubSub.unbounded<string>()
  return {
    started,
    stopped,
    emit: (name) => Effect.asVoid(PubSub.publish(emitted, name)),
    // Subscribed before `started` is reported, so an emit after `started` is never lost.
    changes: (project) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(emitted)
          yield* Queue.offer(started, project.name)
          return Stream.fromSubscription(subscription).pipe(
            Stream.filter((name) => name === project.name),
            Stream.map(() => undefined),
          )
        }),
      ).pipe(Stream.ensuring(Queue.offer(stopped, project.name))),
  }
})

/**
 * Subscribes to `hub.changes` for the rest of the test and waits until the
 * hub's watchers run: `started` must receive a name, so some registered
 * project must use a `makeWatchers` source. The hub subscribes before it
 * starts watchers, so no event after this returns is missed.
 */
export const listen = (hub: Hub["Service"], started: Queue.Queue<string>) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<HubChange>()
    const fiber = yield* hub.changes.pipe(
      Stream.runForEach((change) => Queue.offer(events, change)),
      Effect.forkScoped,
    )
    const first = yield* Queue.take(started)
    return { events, fiber, first }
  })
```

- [ ] **Step 3: Write the failing tests**

Create `test/hub/changes.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Option, Queue, Stream } from "effect"
import { fsSource, type HubChange, type Source } from "../../src/hub/index.ts"
import { type MemoryConfig, memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import {
  Disk,
  diskWith,
  eventually,
  hubOn,
  listen,
  liveTest,
  makeWatchers,
  md,
  takeWithin,
} from "./helpers.ts"

const withProbe = (...more: ReadonlyArray<string>) =>
  diskWith({
    ".todo-md/projects.yaml": md("projects:", "  probe:", "    source: probe", ...more),
  })

describe("changes", () => {
  effectTest(
    "a source's changes arrive as changed events",
    Effect.gen(function* () {
      const watchers = yield* makeWatchers
      const hub = yield* hubOn([memorySource({ kind: "probe", changes: watchers.changes })])
      const { events, first } = yield* listen(hub, watchers.started)
      expect(first).toBe("probe")
      yield* watchers.emit("probe")
      expect(yield* Queue.take(events)).toEqual({ kind: "changed", project: "probe" })
    }),
    withProbe(),
  )

  effectTest(
    "watchers run only while something subscribes",
    Effect.gen(function* () {
      const watchers = yield* makeWatchers
      const hub = yield* hubOn([memorySource({ kind: "probe", changes: watchers.changes })])
      yield* (yield* hub.todo("probe")).add({ title: "Unwatched" })
      yield* hub.projects()
      expect(yield* Queue.size(watchers.started)).toBe(0)
      const { fiber, first } = yield* listen(hub, watchers.started)
      expect(first).toBe("probe")
      yield* Fiber.interrupt(fiber)
      expect(yield* Queue.take(watchers.stopped)).toBe("probe")
    }),
    withProbe(),
  )

  effectTest(
    "mutations publish changed only for sources without changes",
    Effect.gen(function* () {
      const watchers = yield* makeWatchers
      const hub = yield* hubOn([
        memorySource({ kind: "probe", changes: watchers.changes }),
        memorySource(),
      ])
      const { events } = yield* listen(hub, watchers.started)
      yield* (yield* hub.todo("probe")).add({ title: "Watched by its source" })
      yield* (yield* hub.todo("m")).add({ title: "Reported by the hub" })
      expect(yield* Queue.take(events)).toEqual({ kind: "changed", project: "m" })
      expect(yield* Queue.size(events)).toBe(0)
    }),
    withProbe("  m:", "    source: memory"),
  )

  effectTest(
    "the hub's own registry edits publish registry and start or stop watchers",
    Effect.gen(function* () {
      const watchers = yield* makeWatchers
      const hub = yield* hubOn([memorySource({ kind: "probe", changes: watchers.changes })])
      const { events } = yield* listen(hub, watchers.started)
      yield* hub.add({ name: "two", source: "probe", config: {} })
      expect(yield* Queue.take(watchers.started)).toBe("two")
      expect(yield* Queue.take(events)).toEqual({ kind: "registry" })
      yield* hub.rename("two", "three")
      expect(yield* Queue.take(watchers.stopped)).toBe("two")
      expect(yield* Queue.take(watchers.started)).toBe("three")
      expect(yield* Queue.take(events)).toEqual({ kind: "registry" })
      yield* hub.remove("three")
      expect(yield* Queue.take(watchers.stopped)).toBe("three")
      expect(yield* Queue.take(events)).toEqual({ kind: "registry" })
    }),
    withProbe(),
  )

  liveTest(
    "a registry edit from another hub publishes registry",
    Effect.gen(function* () {
      const [watching, editing] = [
        yield* hubOn([memorySource({ kind: "probe" })]),
        yield* hubOn([memorySource({ kind: "probe" })]),
      ]
      const events = yield* Queue.unbounded<HubChange>()
      yield* watching.changes.pipe(
        Stream.runForEach((change) => Queue.offer(events, change)),
        Effect.forkScoped,
      )
      let added = 0
      const seen = yield* eventually(
        // Suspended, so each attempt adds a new name.
        Effect.suspend(() => editing.add({ name: `p${added++}`, source: "probe", config: {} })),
        takeWithin(events, "300 millis"),
      )
      expect(seen).toEqual(Option.some({ kind: "registry" }))
    }),
    withProbe(),
  )

  liveTest(
    "unregistered projects opened by resolve are watched",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      const events = yield* Queue.unbounded<HubChange>()
      yield* hub.changes.pipe(
        Stream.runForEach((change) => Queue.offer(events, change)),
        Effect.forkScoped,
      )
      const info = yield* hub.resolve({ dir: "app", cwd: disk.root })
      let edits = 0
      const seen = yield* eventually(
        Effect.suspend(() => disk.write("app/TODO.md", md("# App", "", `Edit ${edits++}`))),
        takeWithin(events, "300 millis"),
      )
      expect(seen).toEqual(Option.some({ kind: "changed", project: info.name }))
    }),
    diskWith({ "app/TODO.md": md("# App") }),
  )

  liveTest(
    "a registry edit on disk closes the service of a removed project",
    Effect.gen(function* () {
      const disk = yield* Disk
      const closed = yield* Queue.unbounded<string>()
      const base = memorySource()
      const source: Source<MemoryConfig> = {
        ...base,
        open: (project) =>
          Layer.merge(
            base.open(project),
            Layer.effectDiscard(
              Effect.addFinalizer(() => Effect.asVoid(Queue.offer(closed, project.name))),
            ),
          ),
      }
      const hub = yield* hubOn([source])
      yield* hub.changes.pipe(Stream.runDrain, Effect.forkScoped)
      yield* hub.todo("m")
      const seen = yield* eventually(
        disk.write(".todo-md/projects.yaml", md("projects:", "  other:", "    source: memory")),
        takeWithin(closed, "300 millis"),
      )
      expect(seen).toEqual(Option.some("m"))
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects:", "  m:", "    source: memory") }),
  )
})
```

In `test/hub/Hub.test.ts`, inside `describe("todo", …)`, add:

```ts
  effectTest(
    "rebuilds a project's service when its entry changes on disk",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      expect((yield* (yield* hub.todo("app")).list()).title).toBe("A")
      yield* disk.write(".todo-md/projects.yaml", md("projects:", "  app:", "    source: fs", "    path: ~/b"))
      expect((yield* (yield* hub.todo("app")).list()).title).toBe("B")
    }),
    diskWith({
      "a/TODO.md": md("# A"),
      "b/TODO.md": md("# B"),
      ".todo-md/projects.yaml": md("projects:", "  app:", "    source: fs", "    path: ~/a"),
    }),
  )

  effectTest(
    "fails with ProjectNotFound once its entry is removed on disk",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource()])
      yield* hub.todo("m")
      yield* disk.write(".todo-md/projects.yaml", md("projects:"))
      expect((yield* Effect.flip(hub.todo("m")))._tag).toBe("ProjectNotFound")
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects:", "  m:", "    source: memory") }),
  )
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun test test/hub/changes.test.ts test/hub/Hub.test.ts test/hub/testing.test.ts`
Expected: FAIL (`hub.changes` is undefined; the cached `app` service still reads `a`; `todo("m")` still succeeds after removal).

- [ ] **Step 5: Create `src/hub/changes.ts`**

```ts
/**
 * The hub's change feed: a `PubSub` of `HubChange`s. Watchers (one fiber per
 * watched project, plus a watch on `projects.yaml`) are reference-counted:
 * the first subscriber starts them, the last one leaving stops them.
 */

import {
  Effect,
  FiberMap,
  FileSystem,
  Path,
  PubSub,
  RcRef,
  type Scope,
  Semaphore,
  Stream,
} from "effect"
import { TodoStore } from "../spec/index.ts"
import type { RegistryError } from "./errors.ts"
import { registryFile } from "./registry.ts"
import type { SourceEnv } from "./Source.ts"

export type HubChange =
  | { readonly kind: "changed" | "synced"; readonly project: string }
  | { readonly kind: "registry" }

/** A project the hub watches while `changes` has subscribers. */
export interface Watched {
  readonly name: string
  /** Changes when the project's entry does; a new key restarts the watcher. */
  readonly key: string
  readonly changes: Stream.Stream<void, never, SourceEnv>
}

export interface ChangesOptions {
  readonly home: string
  /** The projects to watch now. */
  readonly watched: Effect.Effect<ReadonlyArray<Watched>, RegistryError>
  /** Runs when `projects.yaml` changes on disk, before `registry` is published. */
  readonly onRegistryFile: Effect.Effect<void>
}

export interface Changes {
  readonly stream: Stream.Stream<HubChange>
  publish(change: HubChange): Effect.Effect<void>
  /** Starts and stops project watchers to match `watched`; a no-op while none run. */
  readonly reconcile: Effect.Effect<void>
}

export const makeChanges = (
  options: ChangesOptions,
): Effect.Effect<Changes, never, Scope.Scope | SourceEnv> =>
  Effect.gen(function* () {
    const env = yield* Effect.context<SourceEnv>()
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const pubsub = yield* Effect.acquireRelease(PubSub.unbounded<HubChange>(), PubSub.shutdown)
    const publish = (change: HubChange) => Effect.asVoid(PubSub.publish(pubsub, change))
    let running: Effect.Effect<void> | undefined

    // A missing directory cannot be watched, so the home is created first.
    const registryChanges = Stream.unwrap(
      Effect.as(fs.makeDirectory(options.home, { recursive: true }), fs.watch(options.home)),
    ).pipe(
      Stream.filter((event) => path.basename(event.path) === registryFile),
      Stream.debounce("100 millis"),
    )

    const start = Effect.gen(function* () {
      const fibers = yield* FiberMap.make<string>()
      const keys = new Map<string, string>()
      const lock = yield* Semaphore.make(1)
      const watch = (project: Watched) =>
        project.changes.pipe(
          Stream.runForEach(() => publish({ kind: "changed", project: project.name })),
          Effect.catchDefect((defect) =>
            Effect.logWarning(`stopped watching ${project.name}`, defect),
          ),
          Effect.provideContext(env),
        )
      const reconcile = lock.withPermit(
        Effect.gen(function* () {
          const wanted = yield* options.watched
          const names = new Set(wanted.map((project) => project.name))
          for (const name of [...keys.keys()]) {
            if (names.has(name)) continue
            keys.delete(name)
            yield* FiberMap.remove(fibers, name)
          }
          for (const project of wanted) {
            if (keys.get(project.name) === project.key) continue
            keys.set(project.name, project.key)
            yield* FiberMap.run(fibers, project.name, watch(project))
          }
        }).pipe(
          // An unreadable registry keeps the watchers that run.
          Effect.catch((error) =>
            Effect.logWarning(`could not update project watchers: ${error.message}`),
          ),
        ),
      )
      // Set before the first reconcile, so a concurrent registry edit waits for it and then applies.
      running = reconcile
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          running = undefined
        }),
      )
      yield* reconcile
      yield* registryChanges.pipe(
        Stream.runForEach(() =>
          options.onRegistryFile.pipe(
            Effect.andThen(reconcile),
            Effect.andThen(publish({ kind: "registry" })),
          ),
        ),
        Effect.catch((error) =>
          Effect.logWarning(`stopped watching ${registryFile}: ${error.message}`),
        ),
        Effect.forkScoped,
      )
    })
    const watchers = yield* RcRef.make({ acquire: start })

    return {
      // Subscribed before the watchers start, so their first events are not missed.
      stream: Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(pubsub)
          yield* RcRef.get(watchers)
          return Stream.fromSubscription(subscription)
        }),
      ),
      publish,
      reconcile: Effect.suspend(() => running ?? Effect.void),
    }
  })

/** `store`, running `notify` after each successful mutation. */
export const notifying = (
  store: TodoStore["Service"],
  notify: Effect.Effect<void>,
): TodoStore["Service"] => {
  const after = <A, E>(effect: Effect.Effect<A, E>) => Effect.tap(effect, () => notify)
  return TodoStore.of({
    ...store,
    add: (input, placement) => after(store.add(input, placement)),
    update: (id, patch) => after(store.update(id, patch)),
    move: (id, placement) => after(store.move(id, placement)),
    complete: (id) => after(store.complete(id)),
    reopen: (id) => after(store.reopen(id)),
    remove: (id) => after(store.remove(id)),
    renameGroup: (from, to) => after(store.renameGroup(from, to)),
    comment: (id, input) => after(store.comment(id, input)),
  })
}
```

- [ ] **Step 6: Add `fingerprintOf` to `src/hub/projects.ts` and export `HubChange`**

Append to `src/hub/projects.ts`:

```ts
/** What a project's store is built from; it differs whenever the entry does. */
export const fingerprintOf = (project: Project): string =>
  JSON.stringify([
    project.registered,
    project.kind,
    project.dir ?? null,
    project.config._tag === "Valid" ? project.config.value : project.config.problem.message,
  ])
```

In `src/hub/index.ts`, add:

```ts
export type { HubChange } from "./changes.ts"
```

- [ ] **Step 7: Wire changes into `src/hub/Hub.ts`**

1. Imports: add `type Stream` to the `effect` import; change `import type { StoreError } from "../spec/index.ts"` to `import { type StoreError, TodoStore } from "../spec/index.ts"`; add `import { type HubChange, makeChanges, notifying, type Watched } from "./changes.ts"`; add `fingerprintOf` to the `./projects.ts` import.
2. In the service interface, after `status(…)`, add:

   ```ts
    /** Project, sync and registry changes. Watchers run only while something consumes it. */
    readonly changes: Stream.Stream<HubChange>
   ```

3. In `make`, right after `describe`, add:

   ```ts
    // The fingerprint of the entry each cached service was built from.
    const built = new Map<string, string>()

    const watched = Effect.map(registered, (projects) =>
      [...projects, ...unregistered.all()].flatMap((project): ReadonlyArray<Watched> => {
        const { config } = project
        if (config._tag === "Invalid" || config.source.changes === undefined) return []
        const stream = config.source.changes(sourceProjectOf(project, config.value))
        return [{ name: project.name, key: fingerprintOf(project), changes: stream }]
      }),
    )
    const changes = yield* makeChanges({
      home: options.home,
      watched,
      onRegistryFile: Effect.suspend(() => refreshServices),
    })
    const registryChanged = Effect.andThen(changes.reconcile, changes.publish({ kind: "registry" }))
   ```

4. Replace the `LayerMap.make` builder's last two lines (`const store = …` and `return TodoService.layer…`) with:

   ```ts
            const opened = config.source.open(sourceProjectOf(project, config.value))
            // Sources with `changes` report every change themselves; for the others, the hub
            // reports its own mutations.
            const store =
              config.source.changes !== undefined
                ? opened
                : Layer.effect(
                    TodoStore,
                    Effect.map(TodoStore, (store) =>
                      notifying(store, changes.publish({ kind: "changed", project: name })),
                    ),
                  ).pipe(Layer.provide(opened))
            return TodoService.layer.pipe(Layer.provide(store))
   ```

5. After `services`, add:

   ```ts
    // Drops a cached service, so its scope closes and the next `todo` builds it afresh.
    const forget = (name: string) =>
      Effect.andThen(
        Effect.sync(() => built.delete(name)),
        services.invalidate(name),
      )

    // Callers look the project up first, so an entry changed by another process is seen.
    const serviceOf = (project: Project) =>
      Effect.gen(function* () {
        const key = fingerprintOf(project)
        if (built.get(project.name) !== key) {
          yield* services.invalidate(project.name)
          built.set(project.name, key)
        }
        const context = yield* Effect.scoped(services.contextEffect(project.name))
        return Context.get(context, TodoService)
      }).pipe(
        // A failed build is cached like a success; drop it so the next call retries.
        Effect.tapError(() => forget(project.name)),
      )

    // Another process changed `projects.yaml`: close services built from changed or removed entries.
    const refreshServices = Effect.gen(function* () {
      const current = new Map(
        (yield* registered).map((project) => [project.name, fingerprintOf(project)]),
      )
      for (const [name, key] of [...built]) {
        if (unregistered.get(name) === undefined && current.get(name) !== key) yield* forget(name)
      }
    }).pipe(Effect.catch((error) => Effect.logWarning(`could not refresh projects: ${error.message}`)))
   ```

6. In `add`, replace `yield* services.invalidate(name)` with:

   ```ts
          yield* forget(name)
          yield* registryChanged
   ```

7. In `remove`, replace `yield* services.invalidate(name)` with the same two lines.
8. In `rename`, replace the two `services.invalidate` lines with:

   ```ts
          yield* forget(from)
          yield* forget(to)
          yield* registryChanged
   ```

9. `resolve:` becomes:

   ```ts
      resolve: (at) =>
        inEnv(resolveProject(at, { registered, find, unregistered })).pipe(
          // Resolution may open an unregistered project, which is watched too.
          Effect.tap(() => changes.reconcile),
          Effect.flatMap(describe),
        ),
   ```

10. `todo:` becomes:

    ```ts
      todo: (name) =>
        find(name).pipe(
          Effect.flatMap(serviceOf),
          Effect.tapError(() => forget(name)),
        ),
    ```

11. Add to `Hub.of({…})`, last: `changes: changes.stream,`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test test/hub`, then `bun test test/hub/changes.test.ts` five times in a row.
Expected: PASS every time. If "the hub's own registry edits…" hangs, check that `registryChanged` runs after `forget` in `add`/`rename`/`remove`, and that `reconcile` compares keys (a rename changes both the name and the fingerprint).

- [ ] **Step 9: Gate and commit**

```bash
bun run fix && bun run check
git add src/hub/changes.ts src/hub/testing.ts src/hub/projects.ts src/hub/Hub.ts src/hub/index.ts test/hub/helpers.ts test/hub/changes.test.ts test/hub/Hub.test.ts test/hub/testing.test.ts
git commit -m "Add the hub's changes stream and rebuild services when entries change"
```

---

### Task 5: `sync`, `syncAll` and `autoSync`

**Files:**
- Create: `src/hub/sync.ts`
- Modify: `src/hub/Hub.ts`, `src/hub/index.ts`, `test/hub/helpers.ts` (`hubOn` options), `test/hub/Hub.test.ts` (two `hubOn` call sites)
- Test: `test/hub/sync.test.ts`

**Interfaces:**
- Consumes: `writeState` (Task 2), `HubChange`/`changes.publish` (Task 4), `SyncError` (`src/hub/errors.ts`), `SyncOutcome` (`src/hub/Source.ts`), `makeWatchers`/`listen` (Task 4).
- Produces:
  - `interface SyncResult { readonly project: string; readonly summary: string; readonly ahead?: number; readonly behind?: number; readonly at: DateTime.Utc }`.
  - `interface SyncFailure { readonly project: string; readonly error: SyncError }`.
  - `nothingToSync = "nothing to sync"`.
  - `makeSyncer(publish): (project: Project, source: AnySource, config: unknown) => Effect<SyncResult, SyncError, SourceEnv>`.
  - `HubOptions.autoSync?: Duration.Input`; `Hub.sync(name)`, `Hub.syncAll()`.
  - `hubOn(sources, options?: { wrapFs?; autoSync? })`.

- [ ] **Step 1: Give `hubOn` an options object**

In `test/hub/helpers.ts`, change `hubOn`'s signature and first lines to:

```ts
export const hubOn = (
  sources: ReadonlyArray<AnySource>,
  options: {
    readonly wrapFs?: (fs: FileSystem.FileSystem) => FileSystem.FileSystem
    readonly autoSync?: Duration.Input
  } = {},
): Effect.Effect<Hub["Service"], never, Disk | Scope.Scope> =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const layer = Hub.layer({
      home: `${root}/.todo-md`,
      userHome: root,
      sources,
      ...(options.autoSync === undefined ? {} : { autoSync: options.autoSync }),
    })
    const { wrapFs } = options
```

(the rest is unchanged), and update its doc comment: "`wrapFs` replaces the hub's `FileSystem`, to observe or fail its calls; `autoSync` is passed to `Hub.layer`." In `test/hub/Hub.test.ts`, the two calls `hubOn([memorySource()], (fs) => ({…}))` become `hubOn([memorySource()], { wrapFs: (fs) => ({…}) })`.

- [ ] **Step 2: Write the failing tests**

Create `test/hub/sync.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { DateTime, Effect, Queue } from "effect"
import { TestClock } from "effect/testing"
import { SyncError } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, hubOn, listen, liveTest, makeWatchers, md } from "./helpers.ts"

const epoch = "1970-01-01T00:00:00.000Z"

const failing = (project: string) =>
  new SyncError({ project, reason: "diverged", message: "rebase conflict" })

describe("sync", () => {
  effectTest(
    "a source without sync has nothing to sync and writes nothing",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({ name: "m", source: "memory", config: {} })
      const result = yield* hub.sync("m")
      expect(result).toMatchObject({ project: "m", summary: "nothing to sync" })
      expect(yield* disk.exists(".todo-md/projects/m/state.json")).toBe(false)
    }),
    diskWith({}),
  )

  effectTest(
    "a successful sync is returned and recorded",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([
        memorySource({ sync: () => Effect.succeed({ summary: "pulled 3", ahead: 0, behind: 0 }) }),
      ])
      yield* hub.add({ name: "m", source: "memory", config: {} })
      const result = yield* hub.sync("m")
      expect({ ...result, at: DateTime.formatIso(result.at) }).toEqual({
        project: "m",
        summary: "pulled 3",
        ahead: 0,
        behind: 0,
        at: epoch,
      })
      expect(JSON.parse(yield* disk.read(".todo-md/projects/m/state.json"))).toEqual({
        version: 1,
        lastSync: epoch,
        result: "ok",
        diverged: false,
      })
      const status = yield* hub.status("m")
      expect(status.result).toBe("ok")
      expect(status.lastSync && DateTime.formatIso(status.lastSync)).toBe(epoch)
    }),
    diskWith({}),
  )

  effectTest(
    "a failed sync is recorded, then fails",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource({ sync: (p) => Effect.fail(failing(p.name)) })])
      yield* hub.add({ name: "m", source: "memory", config: {} })
      const error = yield* Effect.flip(hub.sync("m"))
      expect(error).toMatchObject({ _tag: "SyncError", reason: "diverged" })
      expect(yield* hub.status("m")).toMatchObject({
        result: "error",
        error: "rebase conflict",
        diverged: true,
      })
    }),
    diskWith({}),
  )

  effectTest(
    "records the state of a hand-written entry without a data directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource({ sync: () => Effect.succeed({ summary: "ok" }) })])
      yield* hub.sync("m")
      expect(yield* disk.exists(".todo-md/projects/m/state.json")).toBe(true)
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects:", "  m:", "    source: memory") }),
  )

  effectTest(
    "publishes synced after a success and after a failure",
    Effect.gen(function* () {
      const watchers = yield* makeWatchers
      const hub = yield* hubOn([
        memorySource({
          changes: watchers.changes,
          sync: (p) =>
            p.name === "bad" ? Effect.fail(failing(p.name)) : Effect.succeed({ summary: "ok" }),
        }),
      ])
      const { events } = yield* listen(hub, watchers.started)
      yield* hub.sync("good")
      expect(yield* Queue.take(events)).toEqual({ kind: "synced", project: "good" })
      yield* Effect.flip(hub.sync("bad"))
      expect(yield* Queue.take(events)).toEqual({ kind: "synced", project: "bad" })
    }),
    diskWith({
      ".todo-md/projects.yaml": md(
        "projects:",
        "  good:",
        "    source: memory",
        "  bad:",
        "    source: memory",
      ),
    }),
  )

  effectTest(
    "fails with ProjectNotFound for an unknown name",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect((yield* Effect.flip(hub.sync("nope")))._tag).toBe("ProjectNotFound")
    }),
    diskWith({}),
  )

  liveTest(
    "syncs of one project run one after the other",
    Effect.gen(function* () {
      let running = 0
      let most = 0
      const hub = yield* hubOn([
        memorySource({
          sync: () =>
            Effect.gen(function* () {
              running += 1
              most = Math.max(most, running)
              yield* Effect.sleep("50 millis")
              running -= 1
              return { summary: "ok" }
            }),
        }),
      ])
      yield* hub.add({ name: "m", source: "memory", config: {} })
      yield* Effect.all([hub.sync("m"), hub.sync("m"), hub.sync("m")], {
        concurrency: "unbounded",
      })
      expect(most).toBe(1)
    }),
    diskWith({}),
  )
})

describe("syncAll", () => {
  effectTest(
    "returns each syncable project's result or failure, in registry order",
    Effect.gen(function* () {
      const hub = yield* hubOn([
        memorySource({
          sync: (p) =>
            p.name === "b"
              ? Effect.fail(failing(p.name))
              : Effect.succeed({ summary: `synced ${p.name}` }),
        }),
        memorySource({ kind: "plain" }),
      ])
      const outcomes = yield* hub.syncAll()
      expect(
        outcomes.map((outcome) =>
          "error" in outcome
            ? [outcome.project, outcome.error.reason]
            : [outcome.project, outcome.summary],
        ),
      ).toEqual([
        ["a", "synced a"],
        ["b", "diverged"],
        ["c", "synced c"],
      ])
    }),
    diskWith({
      ".todo-md/projects.yaml": md(
        "projects:",
        "  a:",
        "    source: memory",
        "  plain:",
        "    source: plain",
        "  b:",
        "    source: memory",
        "  c:",
        "    source: memory",
      ),
    }),
  )
})

describe("autoSync", () => {
  effectTest(
    "syncs every syncable project one interval after startup",
    Effect.gen(function* () {
      const synced = yield* Queue.unbounded<string>()
      yield* hubOn(
        [memorySource({ sync: (p) => Effect.as(Queue.offer(synced, p.name), { summary: "ok" }) })],
        { autoSync: "1 minute" },
      )
      yield* TestClock.adjust("59 seconds")
      expect(yield* Queue.size(synced)).toBe(0)
      yield* TestClock.adjust("1 second")
      expect(yield* Queue.take(synced)).toBe("m")
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects:", "  m:", "    source: memory") }),
  )
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test test/hub/sync.test.ts`
Expected: FAIL (`hub.sync` is not a function).

- [ ] **Step 4: Create `src/hub/sync.ts`**

```ts
import { DateTime, Effect, Result, Semaphore } from "effect"
import type { HubChange } from "./changes.ts"
import type { SyncError } from "./errors.ts"
import { type Project, sourceProjectOf } from "./projects.ts"
import type { AnySource, SourceEnv } from "./Source.ts"
import { writeState } from "./state.ts"

/** A successful `sync`. */
export interface SyncResult {
  readonly project: string
  /** One line for people, e.g. "pulled 3 commits, pushed 1". */
  readonly summary: string
  readonly ahead?: number
  readonly behind?: number
  readonly at: DateTime.Utc
}

/** A project that failed in `syncAll`. Tell it from a `SyncResult` with `"error" in outcome`. */
export interface SyncFailure {
  readonly project: string
  readonly error: SyncError
}

export const nothingToSync = "nothing to sync"

/**
 * Syncs projects one at a time per project name, records each outcome in the
 * project's `state.json` and publishes `synced`. A failed state write is
 * logged; it never changes the outcome.
 */
export const makeSyncer = (publish: (change: HubChange) => Effect.Effect<void>) => {
  const locks = new Map<string, Semaphore.Semaphore>()
  const lockOf = (name: string) => {
    const existing = locks.get(name)
    if (existing !== undefined) return existing
    const lock = Semaphore.makeUnsafe(1)
    locks.set(name, lock)
    return lock
  }

  return (
    project: Project,
    source: AnySource,
    config: unknown,
  ): Effect.Effect<SyncResult, SyncError, SourceEnv> => {
    const { name } = project
    if (source.sync === undefined) {
      return Effect.map(DateTime.now, (at) => ({ project: name, summary: nothingToSync, at }))
    }
    const sync = source.sync(sourceProjectOf(project, config))
    return lockOf(name).withPermit(
      Effect.gen(function* () {
        const outcome = yield* Effect.result(sync)
        const at = yield* DateTime.now
        if (project.dir !== undefined) {
          const state = Result.isSuccess(outcome)
            ? { lastSync: at, result: "ok" as const, diverged: false }
            : {
                lastSync: at,
                result: "error" as const,
                error: outcome.failure.message,
                diverged: outcome.failure.reason === "diverged",
              }
          yield* writeState(project.dir, state).pipe(
            Effect.catch((error) =>
              Effect.logWarning(`could not record the sync of ${name}: ${error.message}`),
            ),
          )
        }
        yield* publish({ kind: "synced", project: name })
        if (Result.isFailure(outcome)) return yield* outcome.failure
        return { project: name, at, ...outcome.success }
      }),
    )
  }
}
```

- [ ] **Step 5: Wire sync into `src/hub/Hub.ts`**

1. Imports: change the `./errors.ts` import to also bring `type SyncError`; add `import { makeSyncer, type SyncFailure, type SyncResult } from "./sync.ts"`.
2. `HubOptions` gains, last:

   ```ts
  /**
   * Runs `syncAll` this often, starting one interval after the hub starts,
   * until the layer's scope closes. Off by default; for long-running hosts.
   */
  readonly autoSync?: Duration.Input
   ```

3. In the service interface, after `status(…)`, add:

   ```ts
    /** Syncs one project; in this hub, one sync per project runs at a time. */
    sync(
      name: string,
    ): Effect.Effect<
      SyncResult,
      ProjectNotFound | InvalidProjectConfig | SourceUnavailable | RegistryError | SyncError
    >
    /** Syncs every registered project whose source can sync, four at a time. Fails only for an unreadable registry. */
    syncAll(): Effect.Effect<ReadonlyArray<SyncResult | SyncFailure>, RegistryError>
   ```

4. In `make`, after `refreshServices`, add:

   ```ts
    const runSync = makeSyncer(changes.publish)

    const syncAll = Effect.gen(function* () {
      const syncable = (yield* registered).flatMap((project) => {
        const { config } = project
        return config._tag === "Valid" && config.source.sync !== undefined
          ? [{ project, source: config.source, value: config.value }]
          : []
      })
      return yield* Effect.forEach(
        syncable,
        ({ project, source, value }) =>
          inEnv(runSync(project, source, value)).pipe(
            Effect.catch((error) => Effect.succeed<SyncFailure>({ project: project.name, error })),
          ),
        { concurrency: 4 },
      )
    })

    if (options.autoSync !== undefined) {
      yield* Effect.sleep(options.autoSync).pipe(
        Effect.andThen(syncAll),
        Effect.catch((error) => Effect.logWarning(`autoSync: ${error.message}`)),
        Effect.forever,
        Effect.forkScoped,
      )
    }
   ```

5. In `Hub.of({…})`, after `status:`, add:

   ```ts
      sync: (name) =>
        Effect.gen(function* () {
          const project = yield* find(name)
          const { config } = project
          if (config._tag === "Invalid") return yield* config.problem
          return yield* inEnv(runSync(project, config.source, config.value))
        }),

      syncAll: () => syncAll,
   ```

6. In `src/hub/index.ts`, add `export type { SyncFailure, SyncResult } from "./sync.ts"`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test test/hub`
Expected: PASS.

- [ ] **Step 7: Gate and commit**

```bash
bun run fix && bun run check
git add src/hub/sync.ts src/hub/Hub.ts src/hub/index.ts test/hub/helpers.ts test/hub/Hub.test.ts test/hub/sync.test.ts
git commit -m "Add sync, syncAll and autoSync to the hub"
```

---

### Task 6: `overview`

**Files:**
- Create: `src/hub/overview.ts`
- Modify: `src/hub/Hub.ts`, `src/hub/index.ts`
- Test: `test/hub/overview.test.ts`

**Interfaces:**
- Consumes: `formatRef` (Task 1), `describe` (Task 2), `serviceOf` (Task 4), `Listing`, `TaskFilter`, `TaskView` from `src/core/index.ts`.
- Produces: `OverviewQuery`, `OverviewError`, `OverviewEntry`, `OverviewTask`, `Overview`, `overviewOf(query, deps)`, `tasksOf(entries)`; `Hub.overview(query?)`.

- [ ] **Step 1: Write the failing tests**

Create `test/hub/overview.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { diskWith, hubOn, md } from "./helpers.ts"

const registry = diskWith({
  ".todo-md/projects.yaml": md(
    "projects:",
    "  a:",
    "    source: memory",
    "    title: A",
    "    tasks:",
    "      - title: A one",
    "        tags: [x]",
    "      - title: A two",
    "  work:",
    "    source: jira",
    "  b:",
    "    source: other",
    "    tasks:",
    "      - title: B one",
    "        tags: [x]",
  ),
})

// Fresh per test: a memory source keeps its stores for as long as it lives.
const sources = () => [memorySource(), memorySource({ kind: "other" })]

describe("overview", () => {
  effectTest(
    "lists every registered project in registry order, isolating failures",
    Effect.gen(function* () {
      const hub = yield* hubOn(sources())
      const overview = yield* hub.overview()
      expect(
        overview.projects.map((entry) =>
          "listing" in entry
            ? [entry.project.name, entry.listing.title]
            : [entry.project.name, entry.error._tag],
        ),
      ).toEqual([
        ["a", "A"],
        ["work", "SourceUnavailable"],
        ["b", ""],
      ])
      expect(overview.tasks.map(({ project, ref, view }) => [project, ref, view.task.title])).toEqual([
        ["a", "a:1", "A one"],
        ["a", "a:2", "A two"],
        ["b", "b:1", "B one"],
      ])
    }),
    registry,
  )

  effectTest(
    "applies the filter to each project",
    Effect.gen(function* () {
      const hub = yield* hubOn(sources())
      const overview = yield* hub.overview({ filter: { tags: ["x"] } })
      expect(overview.tasks.map(({ ref }) => ref)).toEqual(["a:1", "b:1"])
    }),
    registry,
  )

  effectTest(
    "keeps the given names in order and reports unknown ones",
    Effect.gen(function* () {
      const hub = yield* hubOn(sources())
      const overview = yield* hub.overview({ projects: ["b", "nope", "a"] })
      expect(overview.projects.map((entry) => entry.project.name)).toEqual(["b", "nope", "a"])
      const missing = overview.projects[1]
      expect(missing && "error" in missing ? missing.error._tag : undefined).toBe("ProjectNotFound")
      expect(missing?.project).toMatchObject({ registered: false, status: { result: "error" } })
      expect(overview.tasks.map(({ ref }) => ref)).toEqual(["b:1", "a:1", "a:2"])
    }),
    registry,
  )

  effectTest(
    "keeps only the given sources",
    Effect.gen(function* () {
      const hub = yield* hubOn(sources())
      const overview = yield* hub.overview({ sources: ["other"] })
      expect(overview.projects.map((entry) => entry.project.name)).toEqual(["b"])
    }),
    registry,
  )

  effectTest(
    "includes done tasks after open ones when the filter asks for them",
    Effect.gen(function* () {
      const hub = yield* hubOn(sources())
      yield* (yield* hub.todo("a")).complete("1")
      const overview = yield* hub.overview({ projects: ["a"], filter: { status: "all" } })
      expect(overview.tasks.map(({ ref, view }) => [ref, view.state])).toEqual([
        ["a:2", "ready"],
        ["a:1", "done"],
      ])
    }),
    registry,
  )
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/hub/overview.test.ts`
Expected: FAIL (`hub.overview` is not a function).

- [ ] **Step 3: Create `src/hub/overview.ts`**

```ts
import { Effect, Predicate } from "effect"
import type { Listing, TaskFilter, TaskView } from "../core/index.ts"
import type { StoreError } from "../spec/index.ts"
import {
  type InvalidProjectConfig,
  ProjectNotFound,
  type RegistryError,
  type SourceError,
  type SourceUnavailable,
} from "./errors.ts"
import type { Project } from "./projects.ts"
import { formatRef } from "./refs.ts"
import type { ProjectInfo } from "./Source.ts"

export interface OverviewQuery {
  /** Project names, kept in this order. Default: every registered project, in registry order. */
  readonly projects?: ReadonlyArray<string>
  /** Only projects of these source kinds. Unknown names are always kept. */
  readonly sources?: ReadonlyArray<string>
  /** Passed to each project's `list`. */
  readonly filter?: TaskFilter
}

/** Why a project has no listing. */
export type OverviewError =
  | ProjectNotFound
  | InvalidProjectConfig
  | SourceUnavailable
  | SourceError
  | RegistryError
  | StoreError

export type OverviewEntry =
  | { readonly project: ProjectInfo; readonly listing: Listing }
  | { readonly project: ProjectInfo; readonly error: OverviewError }

export interface OverviewTask {
  readonly project: string
  /** `<project>:<id>`. */
  readonly ref: string
  readonly view: TaskView
}

export interface Overview {
  readonly projects: ReadonlyArray<OverviewEntry>
  /** Each listed project's tasks: in project order, then priority order, then its done tasks. */
  readonly tasks: ReadonlyArray<OverviewTask>
}

/** What `overviewOf` needs from the hub. */
export interface OverviewDeps {
  /** Registered projects in registry order, then unregistered ones opened in the hub. */
  readonly projects: Effect.Effect<ReadonlyArray<Project>, RegistryError>
  describe(project: Project): Effect.Effect<ProjectInfo>
  listing(project: Project, filter: TaskFilter | undefined): Effect.Effect<Listing, OverviewError>
}

/** The entry for a name no project has. */
const missing = (name: string): OverviewEntry => {
  const error = new ProjectNotFound({ name })
  return {
    project: {
      name,
      source: "",
      location: "",
      registered: false,
      syncable: false,
      status: { result: "error", error: error.message },
    },
    error,
  }
}

export const tasksOf = (entries: ReadonlyArray<OverviewEntry>): ReadonlyArray<OverviewTask> =>
  entries.flatMap((entry) => {
    if (!("listing" in entry)) return []
    const { name } = entry.project
    const views = [
      ...entry.listing.sections.flatMap((section) => section.tasks),
      ...entry.listing.done,
    ]
    return views.map((view) => ({ project: name, ref: formatRef(name, view.task.id), view }))
  })

/** `list(filter)` on each chosen project, four at a time; a failing project is an error entry. */
export const overviewOf = (
  query: OverviewQuery,
  deps: OverviewDeps,
): Effect.Effect<Overview, RegistryError> =>
  Effect.gen(function* () {
    const all = yield* deps.projects
    const chosen: ReadonlyArray<Project | string> =
      query.projects === undefined
        ? all.filter((project) => project.registered)
        : query.projects.map((name) => all.find((project) => project.name === name) ?? name)
    const { sources } = query
    const kept =
      sources === undefined
        ? chosen
        : chosen.filter((item) => Predicate.isString(item) || sources.includes(item.kind))
    const entryOf = (project: Project) =>
      Effect.gen(function* () {
        const info = yield* deps.describe(project)
        return yield* deps.listing(project, query.filter).pipe(
          Effect.match({
            onSuccess: (listing): OverviewEntry => ({ project: info, listing }),
            onFailure: (error): OverviewEntry => ({ project: info, error }),
          }),
        )
      })
    const entries = yield* Effect.forEach(
      kept,
      (item) => (Predicate.isString(item) ? Effect.succeed(missing(item)) : entryOf(item)),
      { concurrency: 4 },
    )
    return { projects: entries, tasks: tasksOf(entries) }
  })
```

- [ ] **Step 4: Wire `overview` into `src/hub/Hub.ts`**

1. Imports: add `import { type Overview, type OverviewQuery, overviewOf } from "./overview.ts"`.
2. In the service interface, after `syncAll()`, add:

   ```ts
    /** `list(filter)` across projects, four at a time; a failing project is an error entry. */
    overview(query?: OverviewQuery): Effect.Effect<Overview, RegistryError>
   ```

3. In `Hub.of({…})`, after `syncAll:`, add:

   ```ts
      overview: (query = {}) =>
        overviewOf(query, {
          projects: Effect.map(registered, (projects) => [...projects, ...unregistered.all()]),
          describe,
          listing: (project, filter) =>
            Effect.flatMap(serviceOf(project), (service) => service.list(filter)),
        }),
   ```

4. In `src/hub/index.ts`, add:

   ```ts
export type {
  Overview,
  OverviewEntry,
  OverviewError,
  OverviewQuery,
  OverviewTask,
} from "./overview.ts"
   ```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test test/hub`
Expected: PASS.

- [ ] **Step 6: Gate and commit**

```bash
bun run fix && bun run check
git add src/hub/overview.ts src/hub/Hub.ts src/hub/index.ts test/hub/overview.test.ts
git commit -m "Add a cross-project overview to the hub"
```

---

### Task 7: Docs, and close task 15

**Files:**
- Modify: `src/hub/README.md`, `docs/architecture/hub.md`, `docs/architecture/sources.md`, `src/hub/Source.ts`, `src/hub/errors.ts`, `todo/` (via the CLI)

**Interfaces:** none (documentation and comments only).

- [ ] **Step 1: Doc comments**

- `src/hub/Source.ts`: `ProjectStatus`'s comment becomes "A project's status: its last sync (`state.json`) overlaid with the source's live fields; `error` for a broken entry." `sync?`: "Refreshes the local replica. The hub serializes syncs per project and records the outcome." `changes?`: "Emits when the local replica changes. Runs only while `hub.changes` has subscribers; ends the stream (never fails) when it cannot watch." `status?`: "Live status fields, such as git's `ahead`; they override `state.json`'s. A defect here is logged and ignored."
- `src/hub/errors.ts`: `SyncError`'s comment becomes "A sync failed: `offline`, `auth`, `rejected`, `diverged` (a rebase conflicted) or `remote`."

- [ ] **Step 2: `src/hub/README.md`**

- Replace the status banner with: "> Status: built (tasks 14 and 15). The git and jira sources come in tasks 19 and 06; frontends move onto the hub in tasks 16–18."
- **Contents** rows: `Hub` lists `projects`, `add`, `remove`, `rename`, `resolve`, `todo`, `status`, `sync`, `syncAll`, `overview`, `changes`; `Hub.layer({ home, userHome, sources, autoSync? })`; `ProjectStatus` no longer says "until task 15"; add rows for `SyncResult`, `SyncFailure`; `HubChange`; `Overview`, `OverviewQuery`, `OverviewEntry`, `OverviewTask`, `OverviewError`; `formatRef`, `parseRef`, `TaskRef`; `watchList(root)`.
- **The hub** table: add rows for `status(name)`, `sync(name)`, `syncAll()`, `overview(query?)`, `changes`, each with the behavior below, and change the `todo(name)` row: "looks the project up on every call and rebuilds the cached service when its entry changed, even from another process. Call `todo` per operation rather than holding a service across registry changes: a rebuild closes the old service's scope."
- New sections, short, one bullet per behavior:
  - **Status and sync:** `state.json` shape (`{ version: 1, lastSync?, result, error?, diverged? }`, atomic writes, created with the data directory if missing); missing → `never`, unreadable → `error`; live fields override; a defect in `source.status` is logged at debug and left out; `sync` rules (no `sync` → "nothing to sync", nothing written or published; per-project semaphore; ok → `{ lastSync, result: "ok", diverged: false }`; `SyncError` → `{ lastSync, result: "error", error, diverged }`, then fails; state write failures logged; `synced` published after either); `syncAll` (registered, syncable, concurrency 4, `SyncResult | SyncFailure` in registry order, fails only for an unreadable registry); `autoSync`.
  - **Changes:** lazy and reference-counted; what is watched (registered projects whose source has `changes`, plus unregistered projects opened by `resolve`; re-evaluated after registry changes and resolutions; a changed entry restarts its watcher); `projects.yaml` watch (debounced 100 ms, creates the home; also invalidates cached services of changed or removed entries); `changed` after own mutations only for sources without `changes`; `registry` after own writes, possibly repeated by the watch; watcher failures end that watcher with a warning.
  - **Overview:** default projects (registered only), explicit names (order kept, unregistered ones allowed, unknown ones → placeholder info + `ProjectNotFound`), `sources` filter (never drops unknown names), concurrency 4, `tasks` order and refs.
  - **References:** `formatRef`/`parseRef` rules, with the examples from Task 1.
- **Sources → fs:** replace "`changes` comes in task 15" with the watch behavior (`watchList`: recursive, ignores `.todo.lock` and `*.tmp`, debounced 100 ms; a missing list ends the stream with a warning).
- **Testing:** `memorySource` hooks include `kind`; `test/hub/helpers.ts` also has `liveTest` (real clock), `takeWithin`, `eventually` (repeat a change until a watch sees it), `makeWatchers` and `listen`.
- **Not here:** drop the task 15 line.
- Replace the "Error unions are wider…" paragraph with the full list from Decision 1.

- [ ] **Step 3: `docs/architecture/hub.md` and `sources.md`**

- `hub.md`: replace the banner with "> **Status: built** (tasks 14 and 15); frontends move onto it in tasks 16–18. The design and its reasons are in the [hub design](../superpowers/specs/2026-09-13-hub-design.md)." Remove every "*(task 15)*" marker, and describe the built behavior in one or two lines each: sync status persists in `state.json`; `sync` is serialized per project and publishes `synced`; `changes` is reference-counted; `overview` isolates failures and defaults to registered projects; refs are `<project>:<id>`. In **Boundaries**, change "`autoSync` comes in task 15" to "`autoSync?` runs `syncAll` periodically for long-running hosts".
- `sources.md`: the status becomes "fs built (tasks 14 and 15)". The fs bullet under **Key behaviors** mentions `watchList(root)`, exported for the git source. Mention that `changes` runs only while the hub's `changes` stream has subscribers.

- [ ] **Step 4: Check the design against what was built**

Read the hub design §3 once more. Where this plan decided differently (Decisions 1, 4, 5 and 6), the design's text is still accurate as a sketch; add one line under §3 **Errors**: "The built error unions are wider; see `src/hub/README.md`." Nothing else in the design changes.

- [ ] **Step 5: Gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 6: Close task 15 and check the tasks it unblocks**

```bash
bun src/cli/bin.ts done 15
bun src/cli/bin.ts show 16
bun src/cli/bin.ts show 17
```

If task 16 or 17 describes something this plan decided differently (for example `syncAll` failing with `RegistryError`, `SyncFailure` being told apart with `"error" in outcome`, or `registry` events repeating), add one sentence to that task's file noting it, the way commit `9a95e0e` noted task 14's review findings.

- [ ] **Step 7: Commit**

```bash
git add src/hub/README.md docs/architecture/hub.md docs/architecture/sources.md docs/superpowers/specs/2026-09-13-hub-design.md src/hub/Source.ts src/hub/errors.ts todo
git commit -m "Document the hub's sync, changes and overview and close task 15"
```

---

## Self-review notes

- **Spec coverage:** state.json (Task 2), status + projects include status (2), sync/syncAll/autoSync + SyncError/SyncFailure (5), changes + fsSource.changes + watchList (3, 4), external registry invalidation from task 14's review (4), overview (6), refs (1), README and architecture docs (7). Every test the task lists has a counterpart: state persistence (sync.test), status merge and failing source status (status.test), concurrent syncs (sync.test, live), syncAll with a failure (sync.test), autoSync with TestClock (sync.test), changes from a source / another hub / own mutation / no subscriber (changes.test), fsSource.changes scenarios (fs.test, live, armed by retry), overview (overview.test), refs round trip (refs.test).
- **Types used across tasks:** `describe`, `serviceOf`, `forget`, `changes.publish`, `writeState`, `formatRef`, `fingerprintOf`, `makeWatchers`, `listen`, `liveTest`, `takeWithin`, `eventually`, `hubOn(sources, { wrapFs?, autoSync? })` are each defined once, in the task named in the Interfaces blocks, before any later task uses them.
