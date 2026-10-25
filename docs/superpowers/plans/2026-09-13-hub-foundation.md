# Hub Foundation Implementation Plan (task 14)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `src/hub` (`@lemol/todo-md/hub`), the in-process library every frontend will use to reach projects: the `Source` interface, the registry in `~/.todo-md/projects.yaml`, resolution of the current project, a cached `TodoService` per project, `fsSource`, `projectInput`, and `memorySource` for tests. Sync, status, changes and `overview` are task 15.

**Architecture:**
- **`Hub`** is a `Context.Service` built by `Hub.layer({ home, userHome, sources })`, which requires only Effect's `FileSystem` and `Path`. Sources are plain values; the hub keeps a `Map` from kind to source.
- **The registry** is `<home>/projects.yaml`, edited through yaml's `Document` API (comments and order survive) under fs's `makeLock(home)`, re-read on every edit and written atomically (`.tmp` + rename). A bad entry degrades to a project with an error status; only unreadable YAML fails a read.
- **Per-project services** come from a `LayerMap` keyed by project name: `TodoService.layer` over `source.open(project)`. Registry edits made through the hub invalidate the affected keys.
- **Resolution** is `project` by name, else an unregistered fs project over `dir`, else `findListRoot(cwd)` matched against registered projects with `source.owns`, else an unregistered project named after its directory.

**Tech Stack:** Bun 1.4, TypeScript 7, Effect `4.0.0-rc.108` (`Context`, `Layer`, `LayerMap`, `Schema`, `FileSystem`, `Path`), `yaml` 2.9 (`parseDocument`), `@effect/platform-bun` (tests only, `BunServices.layer`), `bun:test`, Biome.

**Spec:**
- [`todo/hub-and-sources/14-build-the-hub-registry-resolution-and-project-services.md`](../../../todo/hub-and-sources/14-build-the-hub-registry-resolution-and-project-services.md) (`bun src/cli/bin.ts show 14`): the task, its scope and acceptance criteria.
- [Hub design](../specs/2026-09-13-hub-design.md) §1–4: the decisions and their reasons. This plan argues from both; read them first.
- [`docs/architecture/hub.md`](../../architecture/hub.md) and [`sources.md`](../../architecture/sources.md): the living reference this plan updates.

## Global Constraints

- **Read the Effect guide first.** Before writing Effect code, read `node_modules/effect/AGENTS.md` completely. Services are yielded (`yield* FileSystem.FileSystem`); a service class has no `.asEffect()` — use `TodoStore.pipe(Effect.provide(layer))` to get one from a layer.
- **Imports.** `src/hub/**` may import only its own files, `../spec/index.ts`, `../core/index.ts`, `../fs/index.ts`, `effect` and `yaml`. No `node:*`, no `bun`, no `@effect/platform-bun`. `src/hub/testing.ts` may also import `bun:test`/`node:assert`, and only tests may import it. `test/boundaries.test.ts` enforces all of this from Task 1 on.
- **Relative module imports.** Modules import each other through `../<module>/index.ts`, never `@lemol/todo-md/...`.
- **This task changes no frontend behavior.** The CLI and web app keep working exactly as today; the only CLI change is that `NoListFound` moves into the hub and `src/cli/errors.ts` re-exports it.
- **Strict TypeScript.** `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on: never pass `undefined` to an optional property that doesn't include it (build the object conditionally instead).
- **Tests.** `bun:test` plus `effectTest` from `src/spec/testing.ts` (it uses `TestClock`). Tests that contend for the lock must use the real clock (`test` + `Effect.runPromise`), because the lock retries with `Effect.sleep`. No test touches the real `~/.todo-md` or the network.
- **Formatting.** Biome: double quotes, no semicolons, 2-space indent, width 100. Run `bun run fix` after editing; the code below is already formatted.
- **Gate.** `bun run check` (lint + typecheck + all tests) must pass before every commit.
- **Branch.** Work on `main`; do not create a branch or worktree.
- **Commits.** Plain sentences, ending with the attribution trailer your session gives, for example:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JAbSVu93PGiq8VsggEEchV
  ```

## Decisions this plan makes

The design leaves these open or needs them sharpened. Task 7 records them in the docs.

1. **Sources may require `FileSystem` and `Path`.** `SourceEnv = FileSystem | Path` appears in the requirements of every source method; the hub captures both when its layer is built and provides them to each call. Other services (git's `ChildProcess`, jira's `HttpClient`) must still be provided when the source value is built. This keeps `fsSource` a plain value, as the task asks.
2. **`owns` is effectful:** `owns?(config, listRoot): Effect<boolean, never, SourceEnv>`. "Compares the resolved root" needs the disk (`todo/TODO.md` or `TODO.md`).
3. **`SourceProject.dir` is `string | undefined`.** Unregistered projects have no data directory; `undefined` says so instead of passing a path that doesn't exist.
4. **`Source.config` is `Schema.Codec<C, unknown>`**, so a source's encoded form may differ from its type.
5. **`SyncError` and `SyncOutcome` are declared now**, because the `Source` interface names them in `sync?`. The hub doesn't use them until task 15, which takes them as they are (`SyncError { project, reason, message }`, the shape task 15 specifies). `memorySource(hooks)` already accepts `sync`, `changes` and `status` hooks for task 15.
6. **Wider error unions than the design's sketch:** `todo` can also fail with `InvalidProjectConfig` and `RegistryError`; `resolve` with `RegistryError` and `StoreError` (discovery I/O). Both are real failure modes.
7. **Hub errors explain themselves.** `ProjectNotFound`, `NoListFound`, `InvalidProjectConfig` and `SourceUnavailable` override `message` (a getter), so frontends can print `error.message`. `NoListFound` keeps the CLI's text; the CLI's `describeError` keeps its own case for it, unchanged.
8. **`~` expansion is generic:** `~` or `~/…` at the start of any top-level string value expands to `userHome` before the source decodes it. `add` writes the config as given (so `~/app` stays `~/app` in the file).
9. **fs paths must be absolute** after expansion (`FsConfig` rejects `app` with "must be an absolute path"). `projectInput` resolves relative paths against the caller's `cwd`.
10. **Names made from directories are slugged** (`My Tool` → `my-tool`, `nameFrom`), for `fsSource.defaultName` and unregistered projects; an empty result falls back to `list` for unregistered projects and to "a name is required" for `add`.
11. **`projects()` lists registered projects, then the unregistered ones opened in this hub** (`registered: false`), so a web dashboard can show its startup list.
12. **Unregistered names win lookups** (`find` checks them first): they never collide with a registered name when opened, and `add`/`rename` drop an unregistered project whose name they take.
13. **A broken registry never breaks `dir` or discovery.** Resolution treats an unreadable registry as empty there (an agent in a repository keeps working); `project` lookups and `projects()` still fail with `RegistryError`.
14. **Failed builds are not cached.** `LayerMap` caches a failed layer build like a success, so `todo(name)` invalidates the key when it fails; the next call retries (for example after the list is created).
15. **Duplicate source kinds are a defect:** `Hub.layer` dies, since it is a programming error at a composition root.
16. **`projectInput`** also treats `https://github.com/…` without `.git` as git and turns a scheme-less `github.com/owner/repo` into `https://github.com/owner/repo`, so git can clone it. An explicit source other than `fs` or `git` gets an empty config for its frontend to fill (task 06 decides jira's).
17. **Two internal files beyond the task's list:** `names.ts` (the name rule and slugs) and `projects.ts` (the internal `Project` record, config decoding, `ProjectInfo`), to keep `Hub.ts` about wiring.
18. **Known edge for task 16:** `dir` goes through `fsSource`, which prefers `<dir>/todo/TODO.md`. Today's `--dir` opens `<dir>/TODO.md` directly. The two differ only for a directory holding both files; task 16 decides (the hub README says so).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/hub/errors.ts` | `ProjectNotFound`, `NoListFound`, `InvalidProjectConfig`, `SourceUnavailable`, `SourceError`, `RegistryError`, `SyncError` (`Schema.TaggedError`, like `src/spec/errors.ts`). |
| `src/hub/Source.ts` | Types only: `Source<C>`, `AnySource`, `SourceProject<C>`, `SourceEnv`, `SyncOutcome`, `ProjectInfo`, `ProjectStatus`. |
| `src/hub/names.ts` | The name rule `[a-z0-9][a-z0-9-]*`, slugs, numeric suffixes, the name a list directory gives its project. |
| `src/hub/registry.ts` | `makeRegistry(home)`: read entries, edit under the lock, atomic writes, comments preserved. Knows YAML, not sources. |
| `src/hub/sources/fs.ts` | `fsSource`, `FsConfig`, `listRootOf`. |
| `src/hub/testing.ts` | `memorySource(hooks?)` for tests (`@lemol/todo-md/hub/testing`). |
| `src/hub/input.ts` | `AddInput`, `projectInput(target, options)`. |
| `src/hub/projects.ts` | The internal `Project` record: an entry decoded by its source (or its problem), `~` expansion, `ProjectInfo`. |
| `src/hub/resolve.ts` | Unregistered projects and `resolveProject`. |
| `src/hub/Hub.ts` | The `Hub` service and `Hub.layer`: wiring, `add`/`remove`/`rename`, the `LayerMap`. |
| `src/hub/index.ts` | The public entry point. |
| `src/hub/README.md` | The module README. |
| `src/fs/index.ts`, `src/fs/README.md` | Export and document `makeLock`, `Lock`, `defaultLockOptions`. |
| `src/cli/errors.ts` | Re-export `NoListFound` from the hub. |
| `package.json` | Exports `./hub`, `./hub/testing`. |
| `test/boundaries.test.ts` | `hub` rule, `cli` may import `hub`, `hub/testing` treated like `spec/testing`, checker cases. |
| `test/hub/*.test.ts`, `test/hub/helpers.ts` | The hub's tests. |

---

### Task 1: Scaffold the hub module: errors, source types, names and boundaries

**Files:**
- Create: `src/hub/errors.ts`, `src/hub/Source.ts`, `src/hub/names.ts`, `src/hub/index.ts`
- Modify: `package.json` (exports), `src/cli/errors.ts:1-6`, `test/boundaries.test.ts:9-37` and the checker `describe`
- Test: `test/hub/errors.test.ts`, `test/hub/names.test.ts`, `test/boundaries.test.ts`

**Interfaces:**
- Consumes: nothing new (`TodoStore` type from `src/spec/index.ts`).
- Produces:
  - `errors.ts`: `ProjectNotFound({ name })`, `NoListFound({ cwd })`, `InvalidProjectConfig({ name, issues: string[] })`, `SourceUnavailable({ name, source })`, `SourceError({ name, message, cause? })`, `RegistryError({ message, cause? })`, `SyncError({ project, reason, message })`.
  - `Source.ts`: `type SourceEnv = FileSystem.FileSystem | Path.Path`; `interface SourceProject<C> { name; config: C; dir: string | undefined }`; `interface SyncOutcome { summary; ahead?; behind? }`; `interface ProjectStatus { lastSync?; result: "ok" | "error" | "never"; error?; ahead?; behind?; diverged? }`; `interface ProjectInfo { name; source; location; registered; syncable; status }`; `interface Source<C>` (methods below); `type AnySource = Source<unknown>`.
  - `names.ts`: `isValidName(name): boolean`, `nameFrom(text): string | undefined`, `uniqueName(base, taken: ReadonlySet<string>): string`, `projectDirOf(path): string`, `nameForList(path): string | undefined`.

- [ ] **Step 1: Write the failing tests**

`test/hub/errors.test.ts`:

```ts
import { expect, test } from "bun:test"
import {
  InvalidProjectConfig,
  NoListFound,
  ProjectNotFound,
  SourceUnavailable,
} from "../../src/hub/errors.ts"

test("hub errors explain themselves", () => {
  expect(new ProjectNotFound({ name: "x" }).message).toBe("no project named x")
  expect(new NoListFound({ cwd: "/work" }).message).toBe(
    "no todo.md list found from /work; run `todo init` or pass --dir",
  )
  expect(new InvalidProjectConfig({ name: "x", issues: ["a", "b"] }).message).toBe(
    "project x has an invalid config: a; b",
  )
  expect(new SourceUnavailable({ name: "w", source: "jira" }).message).toBe(
    "project w uses the jira source, which is not available here",
  )
})
```

`test/hub/names.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { isValidName, nameForList, nameFrom, uniqueName } from "../../src/hub/names.ts"

describe("project names", () => {
  test.each([
    ["todo-md", true],
    ["a1", true],
    ["7", true],
    ["-a", false],
    ["My-App", false],
    ["a_b", false],
    ["a:b", false],
    ["", false],
  ])("%s valid: %p", (name, valid) => {
    expect(isValidName(name)).toBe(valid)
  })

  test("nameFrom slugs free text", () => {
    expect(nameFrom("My Tool")).toBe("my-tool")
    expect(nameFrom("__app__")).toBe("app")
    expect(nameFrom("!!!")).toBeUndefined()
  })

  test("uniqueName adds the first free numeric suffix", () => {
    expect(uniqueName("app", new Set())).toBe("app")
    expect(uniqueName("app", new Set(["app", "app-2"]))).toBe("app-3")
  })

  test("nameForList uses the project directory, the parent of a todo/ list", () => {
    expect(nameForList("/code/app/todo")).toBe("app")
    expect(nameForList("/code/app/todo/")).toBe("app")
    expect(nameForList("/code/My App")).toBe("my-app")
    expect(nameForList("/")).toBeUndefined()
  })
})
```

In `test/boundaries.test.ts`, add two checker cases inside `describe("the checker", …)`, just before `test("rejects files outside a module", …)`:

```ts
    test("lets hub use core, fs and yaml, and nothing above it", () => {
      const source = [
        'import { TodoService } from "../core/index.ts"',
        'import { FsTodoStore } from "../fs/index.ts"',
        'import { parseDocument } from "yaml"',
      ].join("\n")
      expect(violations(at("hub", "Hub.ts"), source)).toEqual([])
      expect(violations(at("hub", "Hub.ts"), 'import { x } from "../cli/errors.ts"')).toEqual([
        `${at("hub", "Hub.ts")}: module hub must not import module cli`,
      ])
      expect(violations(at("hub", "Hub.ts"), 'import { homedir } from "node:os"')).toEqual([
        `${at("hub", "Hub.ts")}: module hub must not import package node:os`,
      ])
      expect(violations(at("cli", "context.ts"), 'import { Hub } from "../hub/index.ts"')).toEqual(
        [],
      )
    })

    test("keeps hub test helpers out of runtime code", () => {
      expect(
        violations(at("hub", "testing.ts"), 'import { MemoryTodoStore } from "../spec/index.ts"'),
      ).toEqual([])
      expect(
        violations(at("hub", "Hub.ts"), 'import { memorySource } from "./testing.ts"'),
      ).toEqual([`${at("hub", "Hub.ts")}: runtime code imports test helpers (./testing.ts)`])
      expect(
        violations(at("cli", "main.ts"), 'import { memorySource } from "../hub/testing.ts"'),
      ).toEqual([`${at("cli", "main.ts")}: runtime code imports test helpers (../hub/testing.ts)`])
    })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/hub test/boundaries.test.ts`
Expected: FAIL — `Cannot find module '../../src/hub/errors.ts'` (and `names.ts`), and the new checker cases fail with `hub/Hub.ts: not inside a known module`.

- [ ] **Step 3: Implement**

`src/hub/errors.ts`:

```ts
import { Schema } from "effect"

/** No registered project, and no unregistered project open in this hub, has this name. */
export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  name: Schema.String,
}) {
  override get message() {
    return `no project named ${this.name}`
  }
}

/** Resolution found no list by walking up from the working directory. */
export class NoListFound extends Schema.TaggedError<NoListFound>()("NoListFound", {
  cwd: Schema.String,
}) {
  override get message() {
    return `no todo.md list found from ${this.cwd}; run \`todo init\` or pass --dir`
  }
}

/** The project's source rejected its registry entry. */
export class InvalidProjectConfig extends Schema.TaggedError<InvalidProjectConfig>()(
  "InvalidProjectConfig",
  { name: Schema.String, issues: Schema.Array(Schema.String) },
) {
  override get message() {
    return `project ${this.name} has an invalid config: ${this.issues.join("; ")}`
  }
}

/** No loaded source has the kind the project names. */
export class SourceUnavailable extends Schema.TaggedError<SourceUnavailable>()(
  "SourceUnavailable",
  { name: Schema.String, source: Schema.String },
) {
  override get message() {
    return `project ${this.name} uses the ${this.source} source, which is not available here`
  }
}

/** Opening, preparing or removing a project failed in its source. */
export class SourceError extends Schema.TaggedError<SourceError>()("SourceError", {
  name: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Reading or writing `projects.yaml`, or a project's data directory, failed. */
export class RegistryError extends Schema.TaggedError<RegistryError>()("RegistryError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** A sync failed. Declared here for `Source.sync`; the hub runs syncs from task 15. */
export class SyncError extends Schema.TaggedError<SyncError>()("SyncError", {
  project: Schema.String,
  reason: Schema.Literals(["offline", "auth", "rejected", "diverged", "remote"]),
  message: Schema.String,
}) {}
```

`src/hub/Source.ts`:

```ts
import type { DateTime, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect"
import type { TodoStore } from "../spec/index.ts"
import type { SourceError, SyncError } from "./errors.ts"

/** The services the hub provides to every source call, on top of what the source was built with. */
export type SourceEnv = FileSystem.FileSystem | Path.Path

/** The project a source is asked to act on. */
export interface SourceProject<C> {
  readonly name: string
  readonly config: C
  /** The project's data directory, `<home>/projects/<name>`; `undefined` for unregistered projects. */
  readonly dir: string | undefined
}

/** What a successful sync reports. */
export interface SyncOutcome {
  /** One line for people, e.g. "pulled 3 commits, pushed 1". */
  readonly summary: string
  readonly ahead?: number
  readonly behind?: number
}

/** A project's sync status. Until task 15 it is `{ result: "never" }`, or `"error"` for a broken entry. */
export interface ProjectStatus {
  readonly lastSync?: DateTime.Utc
  readonly result: "ok" | "error" | "never"
  /** The last sync error, or why the project's entry is unusable. */
  readonly error?: string
  /** git: local commits not pushed. */
  readonly ahead?: number
  /** git: remote commits not pulled, as of the last fetch. */
  readonly behind?: number
  /** git: the last rebase conflicted. */
  readonly diverged?: boolean
}

/** A project as frontends see it. */
export interface ProjectInfo {
  readonly name: string
  /** The source kind, e.g. `fs`. */
  readonly source: string
  /** A path, URL or site, for display; empty when the entry is unusable. */
  readonly location: string
  readonly registered: boolean
  /** Whether the source can sync. */
  readonly syncable: boolean
  readonly status: ProjectStatus
}

/**
 * A kind of project: turns a registry entry into a `TodoStore`. Sources are
 * plain values passed to `Hub.layer`; any services beyond `SourceEnv` must
 * already be provided when the value is built.
 */
export interface Source<C> {
  /** The `source` value in the registry, e.g. `fs`. Unique among a hub's sources. */
  readonly kind: string
  /** Decodes and validates the entry's fields (everything but `source`), after `~` expansion. */
  readonly config: Schema.Codec<C, unknown>
  /** The name `add` uses when none is given. */
  defaultName?(config: C): string | undefined
  /** A path, URL or site, for display. */
  location(config: C): string
  /** Runs on `add`, after the data directory exists and before the entry is written. */
  prepare?(project: SourceProject<C>): Effect.Effect<void, SourceError, SourceEnv>
  /** The project's store. */
  open(project: SourceProject<C>): Layer.Layer<TodoStore, SourceError, SourceEnv>
  /** Refreshes the local replica. The hub calls it from task 15. */
  sync?(project: SourceProject<C>): Effect.Effect<SyncOutcome, SyncError, SourceEnv>
  /** Emits when the local replica changes. The hub consumes it from task 15. */
  changes?(project: SourceProject<C>): Stream.Stream<void, never, SourceEnv>
  /** Live status fields, such as git's `ahead`. The hub reads it from task 15. */
  status?(project: SourceProject<C>): Effect.Effect<Partial<ProjectStatus>, never, SourceEnv>
  /** Runs on `remove`, before anything is deleted; fails to refuse. */
  beforeRemove?(
    project: SourceProject<C>,
    force: boolean,
  ): Effect.Effect<void, SourceError, SourceEnv>
  /** Whether this project's list is the one at `listRoot`, for resolution from a working directory. */
  owns?(config: C, listRoot: string): Effect.Effect<boolean, never, SourceEnv>
}

/** A source of any config type, as `Hub.layer` takes them. */
export type AnySource = Source<unknown>
```

Why `Source<unknown>` holds any source: every method that takes `C` uses method syntax, which TypeScript checks bivariantly, and `Schema.Codec` is covariant, so a `Source<FsConfig>` is assignable to `Source<unknown>` without `any` (Biome forbids `any` here).

`src/hub/names.ts`:

```ts
/** Project names: lowercase letters, digits and dashes, starting with a letter or digit. */
export const isValidName = (name: string): boolean => /^[a-z0-9][a-z0-9-]*$/.test(name)

/** A valid name made from free text such as a directory name (`My App` → `my-app`); `undefined` if nothing is left. */
export const nameFrom = (text: string): string | undefined => {
  const name = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return name === "" ? undefined : name
}

/** `base`, or `base-2`, `base-3`… : the first one not in `taken`. */
export const uniqueName = (base: string, taken: ReadonlySet<string>): string => {
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`
  return name
}

/** The project directory of a list path: the parent when the path ends in `/todo`. */
export const projectDirOf = (path: string): string => {
  const trimmed = path.replace(/\/+$/, "")
  return trimmed.endsWith("/todo") ? trimmed.slice(0, -"/todo".length) : trimmed
}

/** The name a list directory gives its project: its project directory's basename, as a valid name. */
export const nameForList = (path: string): string | undefined => {
  const dir = projectDirOf(path)
  return nameFrom(dir.slice(dir.lastIndexOf("/") + 1))
}
```

`src/hub/index.ts` (later tasks replace it as they add exports):

```ts
export * from "./errors.ts"
export { isValidName } from "./names.ts"
export type {
  AnySource,
  ProjectInfo,
  ProjectStatus,
  Source,
  SourceEnv,
  SourceProject,
  SyncOutcome,
} from "./Source.ts"
```

`package.json`, in `"exports"`, after `"./fs"`:

```json
    "./fs": "./src/fs/index.ts",
    "./hub": "./src/hub/index.ts",
    "./cli": "./src/cli/index.ts"
```

(`./hub/testing` comes in Task 3, with the file.)

`src/cli/errors.ts`: replace the `NoListFound` class (lines 3–6) with a re-export, so the top of the file reads:

```ts
import { Schema } from "effect"

export { NoListFound } from "../hub/index.ts"

/** The command line asked for nothing to do, or for contradictory things. */
export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", {
```

`src/cli/context.ts` imports `NoListFound` from `./errors.ts` and keeps working unchanged; `describeError` keeps its `"NoListFound"` case.

`test/boundaries.test.ts`: add the hub rule and let the CLI import it:

```ts
  core: { modules: ["spec"], packages: ["effect"] },
  fs: { modules: ["spec", "markdown"], packages: ["effect"] },
  hub: { modules: ["spec", "core", "fs"], packages: ["effect", "yaml"] },
  cli: {
    modules: ["spec", "core", "fs", "hub"],
    packages: ["effect", "@effect/platform-bun", "node:", "bun"],
  },
```

and replace the testing-entry block (the comment, `testingEntry`, `testingPackages` and `isTestingFile`) with:

```ts
// Test helpers shipped for adapters (`@lemol/todo-md/spec/testing`) and for
// hub users (`@lemol/todo-md/hub/testing`) may use the test runner and
// assertions; nothing else may import them.
const testingEntries = [join("spec", "testing"), join("hub", "testing")]
const testingPackages = ["bun:test", "node:assert"]
const isTestingFile = (path: string) =>
  testingEntries.some(
    (entry) => path === entry || path === `${entry}.ts` || path.startsWith(entry + sep),
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/hub test/boundaries.test.ts test/cli/errors.test.ts`
Expected: PASS (the CLI's `describeError` case for `NoListFound` still prints its text).

- [ ] **Step 5: Run the gate**

Run: `bun run fix && bun run check`
Expected: lint clean, both typechecks pass, every test passes.

- [ ] **Step 6: Commit**

```bash
git add src/hub test/hub test/boundaries.test.ts src/cli/errors.ts package.json
git commit -F - <<'EOF'
Scaffold the hub module with its errors, source types and names

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JAbSVu93PGiq8VsggEEchV
EOF
```

---

### Task 2: The registry file

**Files:**
- Modify: `src/fs/index.ts:3`, `src/fs/README.md` (Contents table)
- Create: `src/hub/registry.ts`, `test/hub/helpers.ts`
- Test: `test/hub/registry.test.ts`

**Interfaces:**
- Consumes: `makeLock(root, options?): Effect<Lock, never, FileSystem | Path>` and `Lock = <A, E, R>(effect) => Effect<A, E | StoreError, R>` from `src/fs/lock.ts` (exported by this task); `RegistryError` (Task 1).
- Produces (`src/hub/registry.ts`):
  - `registryFile = "projects.yaml"`
  - `interface RegistryEntry { name: string; value: unknown }` — `value` is the entry as written (`source` plus config fields).
  - `interface RegistryEdit { has(name): boolean; add(name, value: Readonly<Record<string, unknown>>): void; delete(name): void; rename(from, to): void }`
  - `interface Registry { entries: Effect<ReadonlyArray<RegistryEntry>, RegistryError>; update<A, E>(edit: (registry: RegistryEdit) => Effect<A, E>): Effect<A, E | RegistryError> }`
  - `makeRegistry(home): Effect<Registry, never, FileSystem | Path>`
- Produces (`test/hub/helpers.ts`): re-exports `Disk`, `diskWith`, `md` from `test/fs/helpers.ts` (Task 5 adds `hubOn`).

`Disk` (from `test/fs/helpers.ts`) is a temporary directory with `root`, `read`, `write`, `exists` and `tree()` (every file, sorted); `diskWith(files)` builds it.

- [ ] **Step 1: Write the failing test**

`test/hub/helpers.ts`:

```ts
export { Disk, diskWith, md } from "../fs/helpers.ts"
```

`test/hub/registry.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { RegistryError } from "../../src/hub/errors.ts"
import { makeRegistry } from "../../src/hub/registry.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "./helpers.ts"

const registryOnDisk = Effect.gen(function* () {
  const { root } = yield* Disk
  return yield* makeRegistry(`${root}/.todo-md`).pipe(Effect.provide(BunServices.layer))
})

const commented = md(
  "# My projects",
  "projects:",
  "  # The main one",
  "  a:",
  "    source: fs # local",
  "    path: /code/a",
  "  b:",
  "    source: memory",
)

describe("the registry file", () => {
  effectTest(
    "a missing file is an empty registry, and reading creates nothing",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk
      expect(yield* registry.entries).toEqual([])
      expect(yield* (yield* Disk).tree()).toEqual([])
    }),
    diskWith({}),
  )

  effectTest(
    "entries come back in file order with their fields",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk
      expect(yield* registry.entries).toEqual([
        { name: "a", value: { source: "fs", path: "/code/a" } },
        { name: "b", value: { source: "memory" } },
      ])
    }),
    diskWith({ ".todo-md/projects.yaml": commented }),
  )

  effectTest(
    "the first write creates the home and the file",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk
      yield* registry.update((edit) => Effect.sync(() => edit.add("app", { source: "memory" })))
      expect(yield* (yield* Disk).read(".todo-md/projects.yaml")).toBe(
        md("projects:", "  app:", "    source: memory"),
      )
    }),
    diskWith({}),
  )

  effectTest(
    "add, rename and delete keep comments and order",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk
      yield* registry.update((edit) =>
        Effect.sync(() => {
          edit.add("c", { source: "memory", title: "C" })
          edit.rename("a", "renamed")
          edit.delete("b")
        }),
      )
      expect(yield* (yield* Disk).read(".todo-md/projects.yaml")).toBe(
        md(
          "# My projects",
          "projects:",
          "  # The main one",
          "  renamed:",
          "    source: fs # local",
          "    path: /code/a",
          "  c:",
          "    source: memory",
          "    title: C",
        ),
      )
    }),
    diskWith({ ".todo-md/projects.yaml": commented }),
  )

  effectTest(
    "adding to an emptied registry writes a block map",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk
      yield* registry.update((edit) => Effect.sync(() => edit.add("a", { source: "memory" })))
      expect(yield* (yield* Disk).read(".todo-md/projects.yaml")).toBe(
        md("projects:", "  a:", "    source: memory"),
      )
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects: {}") }),
  )

  effectTest(
    "a failing edit writes nothing",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk
      const error = yield* Effect.flip(
        registry.update((edit) =>
          Effect.gen(function* () {
            edit.delete("a")
            return yield* new RegistryError({ message: "no" })
          }),
        ),
      )
      expect(error.message).toBe("no")
      expect(yield* (yield* Disk).read(".todo-md/projects.yaml")).toBe(commented)
      expect(yield* (yield* Disk).exists(".todo-md/.todo.lock")).toBe(false)
    }),
    diskWith({ ".todo-md/projects.yaml": commented }),
  )

  for (const [text, reason] of [
    ["projects: [\n", "unparsable YAML"],
    ["- a\n", "a top level that is not a map"],
    ["projects: [a, b]\n", "projects that is not a map"],
  ] as const) {
    effectTest(
      `fails to read ${reason}`,
      Effect.gen(function* () {
        const registry = yield* registryOnDisk
        const error = yield* Effect.flip(registry.entries)
        expect(error._tag).toBe("RegistryError")
        expect(error.message).toContain("projects.yaml")
      }),
      diskWith({ ".todo-md/projects.yaml": text }),
    )
  }
})

// Real clock: the lock retries with sleeps.
test("concurrent updates from two registries over one home all land", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const [one, two] = [yield* registryOnDisk, yield* registryOnDisk]
      yield* Effect.all(
        Array.from({ length: 10 }, (_, i) =>
          (i % 2 === 0 ? one : two).update((edit) =>
            Effect.sync(() => edit.add(`p${i}`, { source: "memory" })),
          ),
        ),
        { concurrency: "unbounded" },
      )
      const names = (yield* one.entries).map((entry) => entry.name).sort()
      expect(names).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"])
    }).pipe(Effect.provide(diskWith({}))),
  ))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/hub/registry.test.ts`
Expected: FAIL — `Cannot find module '../../src/hub/registry.ts'`.

- [ ] **Step 3: Implement**

`src/fs/index.ts`, line 3 becomes:

```ts
export { defaultLockOptions, type Lock, type LockOptions, makeLock } from "./lock.ts"
```

`src/fs/README.md`: in the Contents table, replace the `LockOptions` row with:

```markdown
| `makeLock(root, options?)`, `Lock`, `defaultLockOptions` | The advisory lock every mutation takes: `<root>/.todo.lock`, created exclusively. `makeLock` returns a `Lock`, a function that runs an effect while holding it and fails with `StoreError` after `timeout`. Exported so the hub (its registry) and the git source (its clone) reuse it; the file name stays `.todo.lock`. |
| `LockOptions` | `timeout` (default 10 s), `staleAfter` (30 s), `retryEvery` (50 ms). |
```

`src/hub/registry.ts`:

```ts
/**
 * `<home>/projects.yaml`: a map from project name to `{ source, ...config }`
 * under the top-level key `projects`. Edits go through yaml's `Document`, so
 * comments and order survive; they run under `<home>/.todo.lock` on a fresh
 * read and are written atomically.
 */

import { Effect, FileSystem, Path } from "effect"
import {
  type Document,
  isMap,
  isNode,
  isScalar,
  type Pair,
  parseDocument,
  type YAMLMap,
} from "yaml"
import { makeLock } from "../fs/index.ts"
import { RegistryError } from "./errors.ts"

export const registryFile = "projects.yaml"

export interface RegistryEntry {
  readonly name: string
  /** The entry as written: `source` plus the source's config fields. */
  readonly value: unknown
}

/** The registry file being edited. */
export interface RegistryEdit {
  has(name: string): boolean
  /** Appends an entry. */
  add(name: string, value: Readonly<Record<string, unknown>>): void
  delete(name: string): void
  /** Renames an entry, keeping its position and comments. */
  rename(from: string, to: string): void
}

export interface Registry {
  /** Every entry, in file order. A missing file is an empty registry. */
  readonly entries: Effect.Effect<ReadonlyArray<RegistryEntry>, RegistryError>
  /** Under the lock: reads the file afresh, runs `edit`, then writes the file atomically. */
  update<A, E>(
    edit: (registry: RegistryEdit) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | RegistryError>
}

const keyOf = (pair: Pair): string => String(isScalar(pair.key) ? pair.key.value : pair.key)

const editOf = (doc: Document): RegistryEdit => {
  const projects = (): YAMLMap | undefined => {
    const node = doc.get("projects", true)
    return isMap(node) ? node : undefined
  }
  const pairOf = (name: string) => projects()?.items.find((pair) => keyOf(pair) === name)
  return {
    has: (name) => pairOf(name) !== undefined,
    add: (name, value) => {
      const map = projects()
      if (map === undefined) {
        doc.set("projects", doc.createNode({ [name]: value }))
        return
      }
      // `projects: {}` parses as a flow map; entries read better as a block.
      if (map.items.length === 0) map.flow = false
      map.add(doc.createPair(name, value))
    },
    delete: (name) => {
      projects()?.delete(name)
    },
    rename: (from, to) => {
      const pair = pairOf(from)
      if (pair === undefined) return
      if (isScalar(pair.key)) pair.key.value = to
      else pair.key = doc.createNode(to)
    },
  }
}

export const makeRegistry = (
  home: string,
): Effect.Effect<Registry, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = path.join(home, registryFile)
    const lock = yield* makeLock(home)
    const failure = (message: string) => (cause: unknown) => new RegistryError({ message, cause })

    const read = Effect.gen(function* () {
      const text = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : ""
      return parseDocument(text)
    }).pipe(
      Effect.mapError(failure(`could not read ${file}`)),
      Effect.flatMap((doc) => {
        const [error] = doc.errors
        if (error !== undefined) {
          return Effect.fail(new RegistryError({ message: `${file}: ${error.message}` }))
        }
        if (doc.contents !== null && !isMap(doc.contents)) {
          return Effect.fail(new RegistryError({ message: `${file}: expected a map` }))
        }
        const projects = doc.get("projects", true)
        if (
          projects !== undefined &&
          !isMap(projects) &&
          !(isScalar(projects) && projects.value === null)
        ) {
          return Effect.fail(new RegistryError({ message: `${file}: projects must be a map` }))
        }
        return Effect.succeed(doc)
      }),
    )

    const write = (doc: Document) =>
      fs
        .writeFileString(`${file}.tmp`, doc.toString())
        .pipe(
          Effect.andThen(fs.rename(`${file}.tmp`, file)),
          Effect.mapError(failure(`could not write ${file}`)),
        )

    return {
      entries: Effect.map(read, (doc) => {
        const projects = doc.get("projects", true)
        if (!isMap(projects)) return []
        return projects.items.map((pair) => ({
          name: keyOf(pair),
          value: isNode(pair.value) ? pair.value.toJS(doc) : pair.value,
        }))
      }),

      update: <A, E>(edit: (registry: RegistryEdit) => Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          yield* fs
            .makeDirectory(home, { recursive: true })
            .pipe(Effect.mapError(failure(`could not create ${home}`)))
          const edited = Effect.gen(function* () {
            const doc = yield* read
            const result = yield* edit(editOf(doc))
            yield* write(doc)
            return result
          })
          // The exit keeps the edit's own errors apart from the lock's `StoreError`.
          const exit = yield* lock(Effect.exit(edited)).pipe(
            Effect.mapError(
              (error) =>
                new RegistryError({
                  message: `could not lock the registry: ${error.message}`,
                  cause: error,
                }),
            ),
          )
          return yield* exit
        }),
    }
  })
```

Notes for the implementer:
- Entries are read pair by pair (not with `doc.toJS()`), because a JavaScript object would move number-like names such as `"7"` to the front.
- Renaming mutates the key scalar in place: a comment above an entry is attached to that scalar, so replacing the node would lose it.
- `Exit` is an `Effect` in Effect 4, so `yield* exit` re-raises the edit's own failure after the lock is released.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/hub/registry.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Run the gate**

Run: `bun run fix && bun run check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/fs/index.ts src/fs/README.md src/hub/registry.ts test/hub
git commit -F - <<'EOF'
Add the hub registry file and export the fs lock

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JAbSVu93PGiq8VsggEEchV
EOF
```

---

### Task 3: fsSource and memorySource

**Files:**
- Create: `src/hub/sources/fs.ts`, `src/hub/testing.ts`
- Modify: `src/hub/index.ts`, `package.json` (exports)
- Test: `test/hub/fs.test.ts`, `test/hub/testing.test.ts`

**Interfaces:**
- Consumes: `Source<C>`, `SourceError` (Task 1); `nameForList` (Task 1); `FsTodoStore.layer({ root })` from `src/fs/index.ts`; `MemoryTodoStore.layer({ title? })`, `TaskInput`, `TodoStore` from `src/spec/index.ts`.
- Produces:
  - `src/hub/sources/fs.ts`: `FsConfig` (`Schema.Struct({ path })`, absolute paths only), `type FsConfig`, `listRootOf(path): Effect<Option<string>, PlatformError, FileSystem | Path>`, `fsSource: Source<FsConfig>` with `kind: "fs"`, `defaultName`, `location`, `open`, `owns`.
  - `src/hub/testing.ts`: `MemoryConfig` (`{ title?, tasks?: TaskInput[] }`), `type MemoryHooks = Partial<Pick<Source<MemoryConfig>, "defaultName" | "prepare" | "sync" | "changes" | "status" | "beforeRemove" | "owns">>`, `memorySource(hooks?): Source<MemoryConfig>` with `kind: "memory"`, `location: () => "memory"`.

- [ ] **Step 1: Write the failing tests**

`test/hub/fs.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, Option } from "effect"
import { fsSource } from "../../src/hub/index.ts"
import { listRootOf } from "../../src/hub/sources/fs.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "./helpers.ts"

const inBun = <A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>) =>
  Effect.provide(effect, BunServices.layer)

describe("fsSource", () => {
  test("names a project after its directory, skipping a trailing todo/", () => {
    expect(fsSource.defaultName?.({ path: "/code/My App" })).toBe("my-app")
    expect(fsSource.defaultName?.({ path: "/code/app/todo" })).toBe("app")
    expect(fsSource.defaultName?.({ path: "/code/app/" })).toBe("app")
    expect(fsSource.defaultName?.({ path: "/" })).toBeUndefined()
    expect(fsSource.location({ path: "/code/app" })).toBe("/code/app")
  })

  effectTest(
    "finds the list at path/todo first, then at path, without walking up",
    Effect.gen(function* () {
      const { root } = yield* Disk
      expect(yield* inBun(listRootOf(`${root}/both`))).toEqual(Option.some(`${root}/both/todo`))
      expect(yield* inBun(listRootOf(`${root}/flat`))).toEqual(Option.some(`${root}/flat`))
      expect(yield* inBun(listRootOf(`${root}/flat/src`))).toEqual(Option.none())
    }),
    diskWith({
      "both/TODO.md": md("# Outer"),
      "both/todo/TODO.md": md("# Inner"),
      "flat/TODO.md": md("# Flat"),
      "flat/src/index.ts": "",
    }),
  )

  effectTest(
    "owns the list root it opens",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const owns = (path: string, listRoot: string) =>
        inBun(fsSource.owns?.({ path }, listRoot) ?? Effect.succeed(false))
      expect(yield* owns(`${root}/both`, `${root}/both/todo`)).toBe(true)
      expect(yield* owns(`${root}/both/todo`, `${root}/both/todo`)).toBe(true)
      expect(yield* owns(`${root}/both`, `${root}/both`)).toBe(false)
      expect(yield* owns(`${root}/missing`, `${root}/missing`)).toBe(false)
    }),
    diskWith({ "both/TODO.md": md("# Outer"), "both/todo/TODO.md": md("# Inner") }),
  )
})
```

`test/hub/testing.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { memorySource } from "../../src/hub/testing.ts"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"

/** Opens `name` from `source` and returns its store, or the open failure. */
const open = (source: ReturnType<typeof memorySource>, name: string, config = {}) =>
  TodoStore.pipe(
    Effect.provide(source.open({ name, config, dir: undefined })),
    Effect.provide(BunServices.layer),
  )

describe("memorySource", () => {
  effectTest(
    "seeds a store from its config on first open",
    Effect.gen(function* () {
      const store = yield* open(memorySource(), "m", { title: "M", tasks: [{ title: "One" }] })
      const list = yield* store.load()
      expect(list.title).toBe("M")
      expect(list.ungrouped.map((task) => task.title)).toEqual(["One"])
    }),
  )

  effectTest(
    "keeps each project's store across opens, per source value",
    Effect.gen(function* () {
      const source = memorySource()
      yield* (yield* open(source, "a")).add({ title: "Kept" })
      expect((yield* (yield* open(source, "a")).load()).ungrouped).toHaveLength(1)
      expect((yield* (yield* open(source, "b")).load()).ungrouped).toHaveLength(0)
      expect((yield* (yield* open(memorySource(), "a")).load()).ungrouped).toHaveLength(0)
    }),
  )

  effectTest(
    "fails with SourceError when a seed task is invalid",
    Effect.gen(function* () {
      const tasks = [{ title: "Self", dependsOn: ["1"] }]
      const error = yield* Effect.flip(open(memorySource(), "m", { tasks }))
      expect(error).toMatchObject({ _tag: "SourceError", name: "m" })
    }),
  )

  effectTest(
    "adds the hooks it is given",
    Effect.sync(() => {
      const source = memorySource({ defaultName: () => "memo" })
      expect(source.kind).toBe("memory")
      expect(source.defaultName?.({})).toBe("memo")
      expect(source.sync).toBeUndefined()
    }),
  )
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/hub/fs.test.ts test/hub/testing.test.ts`
Expected: FAIL — `Cannot find module '../../src/hub/sources/fs.ts'` and `'../../src/hub/testing.ts'`.

- [ ] **Step 3: Implement**

`src/hub/sources/fs.ts`:

```ts
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { FsTodoStore } from "../../fs/index.ts"
import { SourceError } from "../errors.ts"
import { nameForList } from "../names.ts"
import type { Source } from "../Source.ts"

export const FsConfig = Schema.Struct({
  path: Schema.String.check(
    Schema.makeFilter((path: string) => path.startsWith("/") || "must be an absolute path"),
  ),
})
export type FsConfig = typeof FsConfig.Type

/** The list under `path`: `path/todo` if it has a `TODO.md`, else `path` if it has one. No walking up. */
export const listRootOf = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const paths = yield* Path.Path
    const dir = paths.resolve(path)
    for (const root of [paths.join(dir, "todo"), dir]) {
      if (yield* fs.exists(paths.join(root, "TODO.md"))) return Option.some(root)
    }
    return Option.none<string>()
  })

/** A list in a local directory: `{ path }`, the project directory or the list directory itself. */
export const fsSource: Source<FsConfig> = {
  kind: "fs",
  config: FsConfig,
  defaultName: (config) => nameForList(config.path),
  location: (config) => config.path,
  open: (project) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const root = yield* listRootOf(project.config.path).pipe(
          Effect.mapError(
            (error) =>
              new SourceError({
                name: project.name,
                message: `could not look for a list at ${project.config.path}: ${error.message}`,
                cause: error,
              }),
          ),
        )
        if (Option.isNone(root)) {
          return yield* new SourceError({
            name: project.name,
            message: `no TODO.md at ${project.config.path}`,
          })
        }
        return FsTodoStore.layer({ root: root.value })
      }),
    ),
  owns: (config, listRoot) =>
    listRootOf(config.path).pipe(
      Effect.map(Option.contains(listRoot)),
      Effect.orElseSucceed(() => false),
    ),
}
```

`owns` compares the root `open` would use with the one discovery found. Discovery also prefers `todo/TODO.md` at each level, so a registered project at `path` owns exactly the root discovery reports from anywhere inside it.

`src/hub/testing.ts`:

```ts
/**
 * Test helpers for the hub (`@lemol/todo-md/hub/testing`). Only tests may
 * import this module.
 */

import { Effect, Layer, Schema } from "effect"
import { MemoryTodoStore, TaskInput, TodoStore } from "../spec/index.ts"
import { SourceError } from "./errors.ts"
import type { Source } from "./Source.ts"

export const MemoryConfig = Schema.Struct({
  title: Schema.optional(Schema.String),
  /** Tasks added to the store when it is first opened. */
  tasks: Schema.optional(Schema.Array(TaskInput)),
})
export type MemoryConfig = typeof MemoryConfig.Type

/** Optional source behavior a test adds to `memorySource`. */
export type MemoryHooks = Partial<
  Pick<
    Source<MemoryConfig>,
    "defaultName" | "prepare" | "sync" | "changes" | "status" | "beforeRemove" | "owns"
  >
>

/**
 * A fresh `memory` source. Each project's store is a `MemoryTodoStore` seeded
 * from `tasks` on first open and kept by project name for as long as this
 * source value lives, so state survives rebuilt layers within a test.
 */
export const memorySource = (hooks: MemoryHooks = {}): Source<MemoryConfig> => {
  const stores = new Map<string, TodoStore["Service"]>()
  const storeFor = (name: string, config: MemoryConfig) =>
    Effect.gen(function* () {
      const existing = stores.get(name)
      if (existing !== undefined) return existing
      const store = yield* TodoStore.pipe(
        Effect.provide(
          MemoryTodoStore.layer(config.title === undefined ? {} : { title: config.title }),
        ),
      )
      const seedError = (error: { readonly _tag: string }) =>
        new SourceError({ name, message: `could not seed ${name}: ${error._tag}`, cause: error })
      for (const task of config.tasks ?? []) {
        yield* Effect.mapError(store.add(task), seedError)
      }
      stores.set(name, store)
      return store
    })
  return {
    kind: "memory",
    config: MemoryConfig,
    location: () => "memory",
    open: (project) => Layer.effect(TodoStore, storeFor(project.name, project.config)),
    ...hooks,
  }
}
```

Keep `Effect.mapError(store.add(task), seedError)` as written: the piped form makes Biome's formatter oscillate between two layouts.

`src/hub/index.ts` becomes:

```ts
export * from "./errors.ts"
export { isValidName } from "./names.ts"
export type {
  AnySource,
  ProjectInfo,
  ProjectStatus,
  Source,
  SourceEnv,
  SourceProject,
  SyncOutcome,
} from "./Source.ts"
export { FsConfig, fsSource } from "./sources/fs.ts"
```

`package.json`, in `"exports"`:

```json
    "./hub": "./src/hub/index.ts",
    "./hub/testing": "./src/hub/testing.ts",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/hub/fs.test.ts test/hub/testing.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the gate**

Run: `bun run fix && bun run check`
Expected: all green; the boundaries test accepts `src/hub/testing.ts` importing `../spec/index.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/hub test/hub package.json
git commit -F - <<'EOF'
Add the fs source and the memory source for hub tests

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JAbSVu93PGiq8VsggEEchV
EOF
```

---

### Task 4: projectInput

**Files:**
- Create: `src/hub/input.ts`
- Modify: `src/hub/index.ts`
- Test: `test/hub/input.test.ts`

**Interfaces:**
- Consumes: Effect's `Path`.
- Produces (`src/hub/input.ts`):
  - `interface AddInput { name?: string | undefined; source: string; config: unknown }` — the input of `hub.add` (Task 5).
  - `interface ProjectInputOptions { cwd: string; source?: string | undefined; name?: string | undefined }`
  - `projectInput(target, options): Effect<AddInput, never, Path.Path>`

- [ ] **Step 1: Write the failing test**

`test/hub/input.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { type ProjectInputOptions, projectInput } from "../../src/hub/index.ts"

const input = (target: string, options: Partial<ProjectInputOptions> = {}) =>
  Effect.runSync(
    projectInput(target, { cwd: "/work", ...options }).pipe(Effect.provide(BunServices.layer)),
  )

describe("projectInput", () => {
  test.each([
    ["git@github.com:acme/app.git", "git", { url: "git@github.com:acme/app.git" }],
    ["ssh://git@host.example/repo.git", "git", { url: "ssh://git@host.example/repo.git" }],
    [
      "https://git.example.com/team/repo.git",
      "git",
      { url: "https://git.example.com/team/repo.git" },
    ],
    ["https://github.com/acme/app", "git", { url: "https://github.com/acme/app" }],
    ["github.com/acme/app", "git", { url: "https://github.com/acme/app" }],
    ["./repos/app", "fs", { path: "/work/repos/app" }],
    ["app", "fs", { path: "/work/app" }],
    ["/srv/app", "fs", { path: "/srv/app" }],
    ["~/app", "fs", { path: "~/app" }],
  ])("%s is %s", (target, source, config) => {
    expect(input(target)).toEqual({ name: undefined, source, config })
  })

  test("an explicit source and name win", () => {
    expect(input("/srv/repo.git", { source: "git", name: "repo" })).toEqual({
      name: "repo",
      source: "git",
      config: { url: "/srv/repo.git" },
    })
    expect(input("app", { source: "fs" })).toMatchObject({ config: { path: "/work/app" } })
    expect(input("https://acme.atlassian.net", { source: "jira" })).toMatchObject({
      source: "jira",
      config: {},
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/hub/input.test.ts`
Expected: FAIL — `projectInput` is not exported (`SyntaxError: Export named 'projectInput' not found`).

- [ ] **Step 3: Implement**

`src/hub/input.ts`:

```ts
import { Effect, Path } from "effect"

/** What `hub.add` takes. */
export interface AddInput {
  /** Default: the source's `defaultName` for the config. */
  readonly name?: string | undefined
  /** The source kind. */
  readonly source: string
  /** The source's config fields, before `~` expansion. */
  readonly config: unknown
}

export interface ProjectInputOptions {
  /** Resolves relative paths. */
  readonly cwd: string
  /** The source kind, instead of inferring it. */
  readonly source?: string | undefined
  readonly name?: string | undefined
}

const githubWithoutScheme = /^(www\.)?github\.com\//
const gitUrls = [
  /^[\w.-]+@[\w.-]+:/, // scp-like, e.g. git@github.com:owner/repo.git
  /^ssh:\/\//,
  /^https?:\/\/.+\.git\/?$/,
  /^https?:\/\/(www\.)?github\.com\//,
  githubWithoutScheme,
]

/**
 * Turns what a user types to add a project (a path or a URL) into `hub.add`'s
 * input. A git URL is `git`; anything else is an `fs` path, resolved against
 * `cwd` unless it starts with `~`. `options.source` overrides the inference;
 * kinds other than `fs` and `git` get an empty config for the frontend to fill.
 */
export const projectInput = (
  target: string,
  options: ProjectInputOptions,
): Effect.Effect<AddInput, never, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const source =
      options.source ?? (gitUrls.some((pattern) => pattern.test(target)) ? "git" : "fs")
    const home = target === "~" || target.startsWith("~/")
    const config =
      source === "fs"
        ? { path: home ? target : path.resolve(options.cwd, target) }
        : source === "git"
          ? { url: githubWithoutScheme.test(target) ? `https://${target}` : target }
          : {}
    return { name: options.name, source, config }
  })
```

`src/hub/index.ts` becomes:

```ts
export * from "./errors.ts"
export { type AddInput, type ProjectInputOptions, projectInput } from "./input.ts"
export { isValidName } from "./names.ts"
export type {
  AnySource,
  ProjectInfo,
  ProjectStatus,
  Source,
  SourceEnv,
  SourceProject,
  SyncOutcome,
} from "./Source.ts"
export { FsConfig, fsSource } from "./sources/fs.ts"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/hub/input.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Run the gate**

Run: `bun run fix && bun run check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/hub test/hub
git commit -F - <<'EOF'
Add projectInput to turn a typed path or URL into a project

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JAbSVu93PGiq8VsggEEchV
EOF
```

---

### Task 5: The Hub service: projects, add, remove, rename and todo

**Files:**
- Create: `src/hub/projects.ts`, `src/hub/Hub.ts`
- Modify: `src/hub/index.ts`, `test/hub/helpers.ts`
- Test: `test/hub/Hub.test.ts`

**Interfaces:**
- Consumes: `makeRegistry`, `RegistryEntry`, `RegistryEdit` (Task 2); `Source`, `AnySource`, `SourceEnv`, `ProjectInfo`, `SourceProject` (Task 1); `isValidName` (Task 1); errors (Task 1); `AddInput` (Task 4); `fsSource` (Task 3, in tests); `memorySource` (Task 3, in tests); `TodoService` from `src/core/index.ts`.
- Produces:
  - `src/hub/projects.ts`: `type ProjectConfig = { _tag: "Valid"; source: AnySource; value: unknown } | { _tag: "Invalid"; problem: InvalidProjectConfig | SourceUnavailable }`; `interface Project { name; kind; registered; dir: string | undefined; config: ProjectConfig }`; `expandHome(fields, userHome)`; `fieldsOf(name, value): Effect<Record<string, unknown>, InvalidProjectConfig>`; `decodeConfig(source, name, fields, userHome): Effect<unknown, InvalidProjectConfig>`; `registeredProject(entry, sources, dir, userHome): Effect<Project>`; `sourceProjectOf(project, value): SourceProject<unknown>`; `infoOf(project): ProjectInfo`.
  - `src/hub/Hub.ts`: `interface HubOptions { home; userHome; sources: ReadonlyArray<AnySource> }`; `class Hub` (`Context.Service`, key `@lemol/todo-md/hub/Hub`) with `projects()`, `add(input)`, `remove(name, options?)`, `rename(from, to)`, `todo(name)`; `Hub.layer(options): Layer<Hub, never, FileSystem | Path>`. Task 6 adds `resolve`.
  - `test/hub/helpers.ts`: `hubOn(sources): Effect<Hub["Service"], never, Disk | Scope>` — a hub whose home is `<disk root>/.todo-md` and whose `~` is the disk root.

- [ ] **Step 1: Write the failing test**

`test/hub/helpers.ts` becomes:

```ts
import { BunServices } from "@effect/platform-bun"
import { Context, Effect, Layer, type Scope } from "effect"
import { type AnySource, Hub } from "../../src/hub/index.ts"
import { Disk } from "../fs/helpers.ts"

export { Disk, diskWith, md } from "../fs/helpers.ts"

/**
 * A hub whose home is `<disk root>/.todo-md` and whose `~` is the disk root.
 * Several hubs on one disk share a home, like separate processes.
 */
export const hubOn = (
  sources: ReadonlyArray<AnySource>,
): Effect.Effect<Hub["Service"], never, Disk | Scope.Scope> =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const layer = Hub.layer({ home: `${root}/.todo-md`, userHome: root, sources })
    const context = yield* Layer.build(layer.pipe(Layer.provide(BunServices.layer)))
    return Context.get(context, Hub)
  })
```

(`Layer.build` keeps the hub alive for the test's scope, so its cached services persist across calls.)

`test/hub/Hub.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, Exit, FileSystem, Layer } from "effect"
import { fsSource, Hub, SourceError } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, hubOn, md } from "./helpers.ts"

describe("Hub.layer", () => {
  effectTest(
    "dies when two sources share a kind",
    Effect.gen(function* () {
      const layer = Hub.layer({
        home: "/nowhere",
        userHome: "/nowhere",
        sources: [memorySource(), memorySource()],
      })
      const exit = yield* Effect.exit(Layer.build(layer.pipe(Layer.provide(BunServices.layer))))
      expect(Exit.hasDies(exit)).toBe(true)
    }),
  )
})

describe("projects", () => {
  effectTest(
    "an empty home has no projects",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect(yield* hub.projects()).toEqual([])
    }),
    diskWith({}),
  )

  effectTest(
    "broken entries are listed with an error status while the others load",
    Effect.gen(function* () {
      const hub = yield* hubOn([fsSource, memorySource()])
      const projects = yield* hub.projects()
      expect(projects.map(({ name, location, status }) => [name, location, status])).toEqual([
        [
          "work",
          "",
          {
            result: "error",
            error: "project work uses the jira source, which is not available here",
          },
        ],
        [
          "bad",
          "",
          { result: "error", error: expect.stringContaining("project bad has an invalid config") },
        ],
        [
          "plain",
          "",
          {
            result: "error",
            error: "project plain has an invalid config: the entry needs a source",
          },
        ],
        ["ok", "memory", { result: "never" }],
      ])
      expect((yield* Effect.flip(hub.todo("work")))._tag).toBe("SourceUnavailable")
      expect((yield* Effect.flip(hub.todo("bad")))._tag).toBe("InvalidProjectConfig")
      expect((yield* (yield* hub.todo("ok")).list()).title).toBe("")
    }),
    diskWith({
      ".todo-md/projects.yaml": md(
        "projects:",
        "  work:",
        "    source: jira",
        "    site: https://acme.atlassian.net",
        "  bad:",
        "    source: fs",
        "    path: 12",
        "  plain: just text",
        "  ok:",
        "    source: memory",
      ),
    }),
  )

  effectTest(
    "an unreadable registry fails with RegistryError",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect((yield* Effect.flip(hub.projects()))._tag).toBe("RegistryError")
    }),
    diskWith({ ".todo-md/projects.yaml": "projects: [\n" }),
  )
})

describe("add", () => {
  effectTest(
    "writes the entry, creates the data directory and returns the project",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      const info = yield* hub.add({ source: "fs", config: { path: `${disk.root}/app` } })
      expect(info).toEqual({
        name: "app",
        source: "fs",
        location: `${disk.root}/app`,
        registered: true,
        syncable: false,
        status: { result: "never" },
      })
      expect(yield* disk.read(".todo-md/projects.yaml")).toBe(
        md("projects:", "  app:", "    source: fs", `    path: ${disk.root}/app`),
      )
      expect(yield* disk.exists(".todo-md/projects/app")).toBe(true)
      expect(yield* hub.projects()).toEqual([info])
    }),
    diskWith({ "app/todo/TODO.md": md("# App") }),
  )

  effectTest(
    "expands ~ for the source but writes the config as given",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      const info = yield* hub.add({ source: "fs", config: { path: "~/app" } })
      expect(info.location).toBe(`${disk.root}/app`)
      expect(yield* disk.read(".todo-md/projects.yaml")).toBe(
        md("projects:", "  app:", "    source: fs", "    path: ~/app"),
      )
    }),
    diskWith({ "app/TODO.md": md("# App") }),
  )

  effectTest(
    "rejects invalid, taken and missing names",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      const invalid = yield* Effect.flip(hub.add({ name: "My App", source: "memory", config: {} }))
      expect(invalid._tag).toBe("RegistryError")
      expect(invalid.message).toContain("invalid project name My App")
      yield* hub.add({ name: "app", source: "memory", config: {} })
      const taken = yield* Effect.flip(hub.add({ name: "app", source: "memory", config: {} }))
      expect(taken.message).toBe("a project named app already exists")
      const unnamed = yield* Effect.flip(hub.add({ source: "memory", config: {} }))
      expect(unnamed.message).toBe("a name is required")
      expect((yield* hub.projects()).map((project) => project.name)).toEqual(["app"])
    }),
    diskWith({}),
  )

  effectTest(
    "rejects an unknown source and a config its source rejects",
    Effect.gen(function* () {
      const hub = yield* hubOn([fsSource])
      const unknown = yield* Effect.flip(hub.add({ name: "w", source: "jira", config: {} }))
      expect(unknown._tag).toBe("SourceUnavailable")
      const relative = yield* Effect.flip(hub.add({ source: "fs", config: { path: "app" } }))
      expect(relative._tag).toBe("InvalidProjectConfig")
      expect(relative.message).toContain("must be an absolute path")
      const notAMap = yield* Effect.flip(hub.add({ name: "x", source: "fs", config: "app" }))
      expect(notAMap._tag).toBe("InvalidProjectConfig")
    }),
    diskWith({}),
  )

  effectTest(
    "runs prepare in the new data directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      const source = memorySource({
        prepare: (project) =>
          Effect.flatMap(FileSystem.FileSystem, (fs) =>
            fs.writeFileString(`${project.dir}/marker`, project.name),
          ).pipe(Effect.orDie),
      })
      const hub = yield* hubOn([source])
      yield* hub.add({ name: "x", source: "memory", config: {} })
      expect(yield* disk.read(".todo-md/projects/x/marker")).toBe("x")
    }),
    diskWith({}),
  )

  effectTest(
    "a failing prepare leaves neither the entry nor the directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      const source = memorySource({
        prepare: (project) => Effect.fail(new SourceError({ name: project.name, message: "no" })),
      })
      const hub = yield* hubOn([source])
      const error = yield* Effect.flip(hub.add({ name: "x", source: "memory", config: {} }))
      expect(error).toBeInstanceOf(SourceError)
      expect(yield* hub.projects()).toEqual([])
      expect(yield* disk.exists(".todo-md/projects/x")).toBe(false)
    }),
    diskWith({}),
  )
})

describe("remove", () => {
  effectTest(
    "a refusing beforeRemove keeps the entry and the directory, unless forced",
    Effect.gen(function* () {
      const disk = yield* Disk
      const source = memorySource({
        beforeRemove: (project, force) =>
          force
            ? Effect.void
            : Effect.fail(new SourceError({ name: project.name, message: "ahead 1" })),
      })
      const hub = yield* hubOn([source])
      yield* hub.add({ name: "x", source: "memory", config: {} })
      const error = yield* Effect.flip(hub.remove("x"))
      expect(error.message).toBe("ahead 1")
      expect((yield* hub.projects()).map((project) => project.name)).toEqual(["x"])
      expect(yield* disk.exists(".todo-md/projects/x")).toBe(true)
      yield* hub.remove("x", { force: true })
      expect(yield* hub.projects()).toEqual([])
      expect(yield* disk.exists(".todo-md/projects/x")).toBe(false)
    }),
    diskWith({}),
  )

  effectTest(
    "removes a broken entry, and fails for an unknown one",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      yield* hub.remove("work")
      expect(yield* hub.projects()).toEqual([])
      expect((yield* Effect.flip(hub.remove("nope")))._tag).toBe("ProjectNotFound")
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects:", "  work:", "    source: jira") }),
  )

  effectTest(
    "drops the cached project",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({ name: "x", source: "memory", config: {} })
      yield* hub.todo("x")
      yield* hub.remove("x")
      expect((yield* Effect.flip(hub.todo("x")))._tag).toBe("ProjectNotFound")
    }),
    diskWith({}),
  )
})

describe("rename", () => {
  effectTest(
    "moves the entry, the data directory and the cached project",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({ name: "old", source: "memory", config: {} })
      yield* disk.write(".todo-md/projects/old/marker", "kept")
      yield* hub.todo("old")
      const info = yield* hub.rename("old", "new")
      expect(info.name).toBe("new")
      expect(yield* disk.read(".todo-md/projects/new/marker")).toBe("kept")
      expect(yield* disk.exists(".todo-md/projects/old")).toBe(false)
      expect((yield* Effect.flip(hub.todo("old")))._tag).toBe("ProjectNotFound")
      yield* hub.todo("new")
    }),
    diskWith({}),
  )

  effectTest(
    "refuses an unknown project, an invalid name and a taken name",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({ name: "a", source: "memory", config: {} })
      yield* hub.add({ name: "b", source: "memory", config: {} })
      expect((yield* Effect.flip(hub.rename("zzz", "c")))._tag).toBe("ProjectNotFound")
      expect((yield* Effect.flip(hub.rename("a", "B!"))).message).toContain(
        "invalid project name",
      )
      expect((yield* Effect.flip(hub.rename("a", "b"))).message).toBe(
        "a project named b already exists",
      )
      expect((yield* hub.projects()).map((project) => project.name)).toEqual(["a", "b"])
    }),
    diskWith({}),
  )
})

describe("todo", () => {
  effectTest(
    "returns services over the same store each time",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({
        name: "m",
        source: "memory",
        config: { title: "Memory", tasks: [{ title: "Seeded" }] },
      })
      yield* (yield* hub.todo("m")).add({ title: "Added" })
      const listing = yield* (yield* hub.todo("m")).list()
      expect(listing.title).toBe("Memory")
      expect(listing.sections[0]?.tasks.map((view) => view.task.title)).toEqual([
        "Seeded",
        "Added",
      ])
    }),
    diskWith({}),
  )

  effectTest(
    "reaches a registered fs list on disk",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      yield* hub.add({ name: "app", source: "fs", config: { path: `${disk.root}/app` } })
      const todo = yield* hub.todo("app")
      yield* todo.add({ title: "Ship it" })
      expect(yield* disk.read("app/todo/TODO.md")).toBe(md("# App", "", "- [ ] 01 - Ship it"))
      expect((yield* todo.next()).map((view) => view.task.title)).toEqual(["Ship it"])
    }),
    diskWith({ "app/todo/TODO.md": md("# App") }),
  )

  effectTest(
    "fails with SourceError for a missing list, and retries once it exists",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      yield* hub.add({ name: "app", source: "fs", config: { path: `${disk.root}/app` } })
      const error = yield* Effect.flip(hub.todo("app"))
      expect(error.message).toBe(`no TODO.md at ${disk.root}/app`)
      yield* disk.write("app/TODO.md", md("# App"))
      expect((yield* (yield* hub.todo("app")).list()).title).toBe("App")
    }),
    diskWith({}),
  )

  effectTest(
    "fails with ProjectNotFound for an unknown name",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect(yield* Effect.flip(hub.todo("nope"))).toMatchObject({
        _tag: "ProjectNotFound",
        name: "nope",
      })
    }),
    diskWith({}),
  )
})

// Real clock: the registry lock retries with sleeps.
test("concurrent adds from two hubs over one home both land", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const [one, two] = [yield* hubOn([memorySource()]), yield* hubOn([memorySource()])]
      yield* Effect.all(
        Array.from({ length: 10 }, (_, i) =>
          (i % 2 === 0 ? one : two).add({ name: `p${i}`, source: "memory", config: {} }),
        ),
        { concurrency: "unbounded" },
      )
      const names = (yield* one.projects()).map((project) => project.name).sort()
      expect(names).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"])
    }).pipe(Effect.scoped, Effect.provide(diskWith({}))),
  ))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/hub/Hub.test.ts`
Expected: FAIL — `Hub` is not exported from `src/hub/index.ts` (`SyntaxError: Export named 'Hub' not found`).

- [ ] **Step 3: Implement**

`src/hub/projects.ts`:

```ts
import { Effect, Option, Predicate, Schema } from "effect"
import { InvalidProjectConfig, SourceUnavailable } from "./errors.ts"
import type { RegistryEntry } from "./registry.ts"
import type { AnySource, ProjectInfo, SourceProject } from "./Source.ts"

/** A project's config: decoded by its source, or why it cannot be used. */
export type ProjectConfig =
  | { readonly _tag: "Valid"; readonly source: AnySource; readonly value: unknown }
  | { readonly _tag: "Invalid"; readonly problem: InvalidProjectConfig | SourceUnavailable }

/** A project as the hub keeps it: a registry entry, or an unregistered list opened in this hub. */
export interface Project {
  readonly name: string
  /** The source kind the project names; empty when its entry names none. */
  readonly kind: string
  readonly registered: boolean
  /** `<home>/projects/<name>` for registered projects. */
  readonly dir: string | undefined
  readonly config: ProjectConfig
}

const Fields = Schema.Record(Schema.String, Schema.Unknown)

/** `~` or `~/…` at the start of a top-level string value expands to `userHome`. */
export const expandHome = (
  fields: Readonly<Record<string, unknown>>,
  userHome: string,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      Predicate.isString(value) && (value === "~" || value.startsWith("~/"))
        ? `${userHome}${value.slice(1)}`
        : value,
    ]),
  )

const withoutSource = (fields: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "source"))

/** The config fields of an `add` input: a map, without `source`. */
export const fieldsOf = (
  name: string,
  value: unknown,
): Effect.Effect<Record<string, unknown>, InvalidProjectConfig> =>
  Schema.decodeUnknownEffect(Fields)(value).pipe(
    Effect.mapError(() => new InvalidProjectConfig({ name, issues: ["expected a map of fields"] })),
    Effect.map(withoutSource),
  )

/** Decodes a project's fields (after `~` expansion) with its source's schema. */
export const decodeConfig = (
  source: AnySource,
  name: string,
  fields: Readonly<Record<string, unknown>>,
  userHome: string,
): Effect.Effect<unknown, InvalidProjectConfig> =>
  Schema.decodeUnknownEffect(source.config)(expandHome(fields, userHome)).pipe(
    Effect.mapError((error) => new InvalidProjectConfig({ name, issues: [error.message] })),
  )

const invalid = (problem: InvalidProjectConfig | SourceUnavailable): ProjectConfig => ({
  _tag: "Invalid",
  problem,
})

/** A registry entry as a project. Never fails: an unusable entry keeps its problem. */
export const registeredProject = (
  entry: RegistryEntry,
  sources: ReadonlyMap<string, AnySource>,
  dir: string,
  userHome: string,
): Effect.Effect<Project> =>
  Effect.gen(function* () {
    const { name } = entry
    const base = { name, registered: true, dir }
    const fields = yield* Effect.option(Schema.decodeUnknownEffect(Fields)(entry.value))
    const kind = Option.getOrUndefined(fields)?.source
    if (Option.isNone(fields) || !Predicate.isString(kind)) {
      return {
        ...base,
        kind: "",
        config: invalid(new InvalidProjectConfig({ name, issues: ["the entry needs a source"] })),
      }
    }
    const source = sources.get(kind)
    if (source === undefined) {
      return { ...base, kind, config: invalid(new SourceUnavailable({ name, source: kind })) }
    }
    const config = yield* decodeConfig(source, name, withoutSource(fields.value), userHome).pipe(
      Effect.match({
        onFailure: invalid,
        onSuccess: (value): ProjectConfig => ({ _tag: "Valid", source, value }),
      }),
    )
    return { ...base, kind, config }
  })

/** What a source is given for `project`. */
export const sourceProjectOf = (project: Project, value: unknown): SourceProject<unknown> => ({
  name: project.name,
  config: value,
  dir: project.dir,
})

export const infoOf = (project: Project): ProjectInfo => {
  const { config } = project
  if (config._tag === "Invalid") {
    return {
      name: project.name,
      source: project.kind,
      location: "",
      registered: project.registered,
      syncable: false,
      status: { result: "error", error: config.problem.message },
    }
  }
  return {
    name: project.name,
    source: project.kind,
    location: config.source.location(config.value),
    registered: project.registered,
    syncable: config.source.sync !== undefined,
    status: { result: "never" },
  }
}
```

`src/hub/Hub.ts`:

```ts
import {
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  LayerMap,
  Path,
  type PlatformError,
} from "effect"
import { TodoService } from "../core/index.ts"
import {
  type InvalidProjectConfig,
  ProjectNotFound,
  RegistryError,
  type SourceError,
  SourceUnavailable,
} from "./errors.ts"
import type { AddInput } from "./input.ts"
import { isValidName } from "./names.ts"
import {
  decodeConfig,
  fieldsOf,
  infoOf,
  type Project,
  registeredProject,
  sourceProjectOf,
} from "./projects.ts"
import { makeRegistry } from "./registry.ts"
import type { AnySource, ProjectInfo, SourceEnv } from "./Source.ts"

export interface HubOptions {
  /** The hub's directory: apps pass `$TODO_MD_HOME`, else `<userHome>/.todo-md`. */
  readonly home: string
  /** The OS user's home directory: `~` in registry values expands to it. */
  readonly userHome: string
  /** The sources this hub can open; kinds must be unique. */
  readonly sources: ReadonlyArray<AnySource>
}

/**
 * Every frontend's way to reach projects: the registry, resolution of the
 * current project, and a `TodoService` per project.
 */
export class Hub extends Context.Service<
  Hub,
  {
    /** Registered projects, in registry order. */
    projects(): Effect.Effect<ReadonlyArray<ProjectInfo>, RegistryError>
    add(
      input: AddInput,
    ): Effect.Effect<
      ProjectInfo,
      RegistryError | InvalidProjectConfig | SourceUnavailable | SourceError
    >
    remove(
      name: string,
      options?: { readonly force?: boolean },
    ): Effect.Effect<void, ProjectNotFound | RegistryError | SourceError>
    rename(from: string, to: string): Effect.Effect<ProjectInfo, ProjectNotFound | RegistryError>
    todo(
      name: string,
    ): Effect.Effect<
      TodoService["Service"],
      ProjectNotFound | InvalidProjectConfig | SourceUnavailable | SourceError | RegistryError
    >
  }
>()("@lemol/todo-md/hub/Hub") {
  /** Requires `FileSystem` and `Path`. Dies if two sources share a kind. */
  static readonly layer = (
    options: HubOptions,
  ): Layer.Layer<Hub, never, FileSystem.FileSystem | Path.Path> => Layer.effect(Hub, make(options))
}

const make = (options: HubOptions) =>
  Effect.gen(function* () {
    const env = yield* Effect.context<SourceEnv>()
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const sources = new Map<string, AnySource>()
    for (const source of options.sources) {
      if (sources.has(source.kind)) {
        return yield* Effect.die(new Error(`two sources have the kind ${source.kind}`))
      }
      sources.set(source.kind, source)
    }
    const registry = yield* makeRegistry(options.home)
    const dirOf = (name: string) => path.join(options.home, "projects", name)
    const inEnv = <A, E>(effect: Effect.Effect<A, E, SourceEnv>) =>
      Effect.provideContext(effect, env)
    const ioError = (message: string) => (cause: PlatformError.PlatformError) =>
      new RegistryError({ message: `${message}: ${cause.message}`, cause })
    const nameError = (name: string) =>
      new RegistryError({
        message: `invalid project name ${name}: use lowercase letters, digits and dashes`,
      })
    const takenError = (name: string) =>
      new RegistryError({ message: `a project named ${name} already exists` })

    const registered = registry.entries.pipe(
      Effect.flatMap((entries) =>
        Effect.forEach(entries, (entry) =>
          registeredProject(entry, sources, dirOf(entry.name), options.userHome),
        ),
      ),
    )

    const find = (name: string): Effect.Effect<Project, ProjectNotFound | RegistryError> =>
      registered.pipe(
        Effect.flatMap((projects) => {
          const found = projects.find((project) => project.name === name)
          return found === undefined
            ? Effect.fail(new ProjectNotFound({ name }))
            : Effect.succeed(found)
        }),
      )

    const services = yield* LayerMap.make(
      (name: string) =>
        Layer.unwrap(
          Effect.gen(function* () {
            const project = yield* find(name)
            const { config } = project
            if (config._tag === "Invalid") return yield* config.problem
            const store = config.source.open(sourceProjectOf(project, config.value))
            return TodoService.layer.pipe(Layer.provide(store))
          }),
        ),
      { idleTimeToLive: Duration.infinity },
    )

    return Hub.of({
      projects: () => Effect.map(registered, (projects) => projects.map(infoOf)),

      add: (input) =>
        Effect.gen(function* () {
          const label = input.name ?? "(unnamed)"
          const source = sources.get(input.source)
          if (source === undefined) {
            return yield* new SourceUnavailable({ name: label, source: input.source })
          }
          const fields = yield* fieldsOf(label, input.config)
          const config = yield* decodeConfig(source, label, fields, options.userHome)
          const name = input.name ?? source.defaultName?.(config)
          if (name === undefined) {
            return yield* new RegistryError({ message: "a name is required" })
          }
          if (!isValidName(name)) return yield* nameError(name)
          if ((yield* registry.entries).some((entry) => entry.name === name)) {
            return yield* takenError(name)
          }
          const dir = dirOf(name)
          yield* fs
            .makeDirectory(dir, { recursive: true })
            .pipe(Effect.mapError(ioError(`could not create ${dir}`)))
          yield* Effect.gen(function* () {
            if (source.prepare !== undefined) {
              yield* inEnv(source.prepare({ name, config, dir }))
            }
            yield* registry.update((edit) =>
              edit.has(name)
                ? Effect.fail(takenError(name))
                : Effect.sync(() => edit.add(name, { source: source.kind, ...fields })),
            )
          }).pipe(Effect.onError(() => Effect.ignore(fs.remove(dir, { recursive: true }))))
          yield* services.invalidate(name)
          return infoOf({
            name,
            kind: source.kind,
            registered: true,
            dir,
            config: { _tag: "Valid", source, value: config },
          })
        }),

      remove: (name, options) =>
        Effect.gen(function* () {
          const project = (yield* registered).find((candidate) => candidate.name === name)
          if (project === undefined) return yield* new ProjectNotFound({ name })
          const { config } = project
          if (config._tag === "Valid" && config.source.beforeRemove !== undefined) {
            const refusal = config.source.beforeRemove(
              sourceProjectOf(project, config.value),
              options?.force === true,
            )
            yield* inEnv(refusal)
          }
          yield* registry.update((edit) =>
            edit.has(name)
              ? Effect.sync(() => edit.delete(name))
              : Effect.fail(new ProjectNotFound({ name })),
          )
          yield* services.invalidate(name)
          const dir = dirOf(name)
          yield* fs
            .remove(dir, { recursive: true, force: true })
            .pipe(Effect.mapError(ioError(`could not remove ${dir}`)))
        }),

      rename: (from, to) =>
        Effect.gen(function* () {
          const [oldDir, newDir] = [dirOf(from), dirOf(to)]
          let moved = false
          yield* registry
            .update((edit) =>
              Effect.gen(function* () {
                if (!edit.has(from)) return yield* new ProjectNotFound({ name: from })
                if (from === to) return
                if (!isValidName(to)) return yield* nameError(to)
                if (edit.has(to)) return yield* takenError(to)
                edit.rename(from, to)
                const move = ioError(`could not move ${oldDir}`)
                if (yield* fs.exists(oldDir).pipe(Effect.mapError(move))) {
                  yield* fs.rename(oldDir, newDir).pipe(Effect.mapError(move))
                  moved = true
                }
              }),
            )
            // The entry keeps its old name if the write failed, so the directory goes back too.
            .pipe(
              Effect.onError(() =>
                moved ? Effect.ignore(fs.rename(newDir, oldDir)) : Effect.void,
              ),
            )
          yield* services.invalidate(from)
          yield* services.invalidate(to)
          return infoOf(yield* find(to))
        }),

      todo: (name) =>
        Effect.scoped(services.contextEffect(name)).pipe(
          Effect.map((context) => Context.get(context, TodoService)),
          // A failed build is cached like a success; drop it so the next call retries.
          Effect.tapError(() => services.invalidate(name)),
        ),
    })
  })
```

How the pieces fit (read before changing anything):
- **`LayerMap` with `idleTimeToLive: Duration.infinity`.** `todo` takes the key's context in a short scope; with an infinite idle time the built service stays in the map after that scope closes, so the next `todo(name)` reuses it. `invalidate` removes it.
- **`inEnv`** provides the `FileSystem` and `Path` captured when the layer was built to source effects (`SourceEnv`). The `LayerMap` captures them the same way for `source.open`.
- **`add` order** follows the task: validate, create `<home>/projects/<name>/`, `prepare`, then write the entry under the lock (re-checking the name there, since another process may have taken it). Any failure after the directory exists removes it.
- **`add` writes `fields` as given** (without `source`, before `~` expansion), not the decoded config.
- **`rename`** moves the data directory inside the locked edit, after the entry is renamed in the document; if the write then fails, `onError` moves it back.

`src/hub/index.ts` becomes:

```ts
export * from "./errors.ts"
export { Hub, type HubOptions } from "./Hub.ts"
export { type AddInput, type ProjectInputOptions, projectInput } from "./input.ts"
export { isValidName } from "./names.ts"
export type {
  AnySource,
  ProjectInfo,
  ProjectStatus,
  Source,
  SourceEnv,
  SourceProject,
  SyncOutcome,
} from "./Source.ts"
export { FsConfig, fsSource } from "./sources/fs.ts"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/hub/Hub.test.ts`
Expected: PASS (20 tests).

- [ ] **Step 5: Run the gate**

Run: `bun run fix && bun run check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/hub test/hub
git commit -F - <<'EOF'
Add the Hub service with the registry and per-project services

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JAbSVu93PGiq8VsggEEchV
EOF
```

---

### Task 6: Resolution of the current project

**Files:**
- Create: `src/hub/resolve.ts`
- Modify: `src/hub/Hub.ts`, `src/hub/index.ts`
- Test: `test/hub/resolve.test.ts`, `test/hub/index.test.ts`

**Interfaces:**
- Consumes: `Project` (Task 5); `nameForList`, `uniqueName` (Task 1); `fsSource` (Task 3); `findListRoot(cwd): Effect<Option<string>, StoreError, FileSystem | Path>` from `src/fs/index.ts`; `NoListFound`, `ProjectNotFound`, `RegistryError` (Task 1).
- Produces:
  - `src/hub/resolve.ts`: `interface ResolveInput { project?: string | undefined; dir?: string | undefined; cwd: string }`; `interface Unregistered { get(name); all(); forget(name); open(list, registered: ReadonlyArray<string>): Project }`; `makeUnregistered(): Unregistered`; `interface Resolution { registered; find(name); unregistered }`; `resolveProject(at, hub: Resolution): Effect<Project, ProjectNotFound | RegistryError | NoListFound | StoreError, SourceEnv>`.
  - `Hub` gains `resolve(at: ResolveInput): Effect<ProjectInfo, ProjectNotFound | NoListFound | RegistryError | StoreError>`; `projects()` also lists unregistered projects opened in the hub; `todo(name)` reaches them.

- [ ] **Step 1: Write the failing tests**

`test/hub/resolve.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { fsSource } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, hubOn, md } from "./helpers.ts"

const lists = {
  "app/todo/TODO.md": md("# App"),
  "app/src/index.ts": "",
  "work/app/TODO.md": md("# Work app"),
  "other/My Tool/TODO.md": md("# Tool"),
  "empty/file.ts": "",
}

describe("resolve", () => {
  effectTest(
    "project wins over dir, and an unknown project fails",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource, memorySource()])
      yield* hub.add({ name: "m", source: "memory", config: {} })
      const info = yield* hub.resolve({ project: "m", dir: "work/app", cwd: root })
      expect(info).toMatchObject({ name: "m", source: "memory", registered: true })
      const error = yield* Effect.flip(hub.resolve({ project: "nope", cwd: root }))
      expect(error).toMatchObject({ _tag: "ProjectNotFound", name: "nope" })
    }),
    diskWith(lists),
  )

  effectTest(
    "dir opens an unregistered fs project over that list",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])
      const info = yield* hub.resolve({ dir: "app", cwd: `${root}/work` })
      expect(info).toEqual({
        name: "app",
        source: "fs",
        location: `${root}/work/app`,
        registered: false,
        syncable: false,
        status: { result: "never" },
      })
      expect((yield* (yield* hub.todo("app")).list()).title).toBe("Work app")
    }),
    diskWith(lists),
  )

  effectTest(
    "discovery inside a registered fs project resolves to it",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])
      yield* hub.add({ name: "main", source: "fs", config: { path: `${root}/app` } })
      const info = yield* hub.resolve({ cwd: `${root}/app/src` })
      expect(info).toMatchObject({ name: "main", registered: true })
    }),
    diskWith(lists),
  )

  effectTest(
    "an unregistered list is named after its project directory, with a suffix when taken",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource, memorySource()])
      yield* hub.add({ name: "app", source: "memory", config: {} })
      const first = yield* hub.resolve({ cwd: `${root}/app/src` })
      expect(first).toMatchObject({
        name: "app-2",
        registered: false,
        location: `${root}/app/todo`,
      })
      const second = yield* hub.resolve({ cwd: `${root}/work/app` })
      expect(second.name).toBe("app-3")
      expect((yield* hub.resolve({ cwd: `${root}/app` })).name).toBe("app-2")
      expect((yield* hub.resolve({ cwd: `${root}/other/My Tool` })).name).toBe("my-tool")
      expect((yield* hub.projects()).map((project) => project.name)).toEqual([
        "app",
        "app-2",
        "app-3",
        "my-tool",
      ])
      expect((yield* (yield* hub.todo("app-2")).list()).title).toBe("App")
    }),
    diskWith(lists),
  )

  effectTest(
    "no list fails with NoListFound",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])
      const error = yield* Effect.flip(hub.resolve({ cwd: `${root}/empty` }))
      expect(error).toMatchObject({ _tag: "NoListFound", cwd: `${root}/empty` })
      expect(error.message).toBe(
        `no todo.md list found from ${root}/empty; run \`todo init\` or pass --dir`,
      )
    }),
    diskWith(lists),
  )

  effectTest(
    "a broken registry does not stop discovery",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])
      const info = yield* hub.resolve({ cwd: `${root}/app` })
      expect(info).toMatchObject({ name: "app", registered: false })
      expect((yield* (yield* hub.todo("app")).list()).title).toBe("App")
    }),
    diskWith({ ...lists, ".todo-md/projects.yaml": "projects: [\n" }),
  )
})
```

(The "no list" case relies on no `TODO.md` above the temporary directory, as `test/fs/discovery.test.ts` already does.)

`test/hub/index.test.ts`:

```ts
import { expect, test } from "bun:test"
import * as hub from "../../src/hub/index.ts"
import * as testing from "../../src/hub/testing.ts"

test("the public entry point exposes the hub, its errors, fsSource and projectInput", () => {
  expect(hub.Hub.key).toBe("@lemol/todo-md/hub/Hub")
  for (const name of [
    "ProjectNotFound",
    "NoListFound",
    "InvalidProjectConfig",
    "SourceUnavailable",
    "SourceError",
    "RegistryError",
    "SyncError",
    "fsSource",
    "FsConfig",
    "projectInput",
    "isValidName",
  ]) {
    expect(hub).toHaveProperty(name)
  }
  expect(testing.memorySource().kind).toBe("memory")
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/hub/resolve.test.ts test/hub/index.test.ts`
Expected: `resolve.test.ts` FAILS with `TypeError: hub.resolve is not a function` (and a type error in `bun run typecheck`); `index.test.ts` already passes, since it only pins the exports from Tasks 1–5.

- [ ] **Step 3: Implement**

`src/hub/resolve.ts`:

```ts
import { Effect, Option, Path } from "effect"
import { findListRoot } from "../fs/index.ts"
import type { StoreError } from "../spec/index.ts"
import { NoListFound, type ProjectNotFound, type RegistryError } from "./errors.ts"
import { nameForList, uniqueName } from "./names.ts"
import type { Project } from "./projects.ts"
import type { SourceEnv } from "./Source.ts"
import { fsSource } from "./sources/fs.ts"

/** Where a frontend is: its `--project` and `--dir` flags and working directory. */
export interface ResolveInput {
  /** A project name. Wins over `dir`; frontends reject both together before calling. */
  readonly project?: string | undefined
  /** A list directory, relative to `cwd`. */
  readonly dir?: string | undefined
  readonly cwd: string
}

/** Unregistered projects opened in one hub: fs lists, one per list path, kept for the hub's lifetime. */
export interface Unregistered {
  get(name: string): Project | undefined
  all(): ReadonlyArray<Project>
  forget(name: string): void
  /** The project over `list`, opened on first use with a name that is not in `registered` or already open. */
  open(list: string, registered: ReadonlyArray<string>): Project
}

export const makeUnregistered = (): Unregistered => {
  const byPath = new Map<string, Project>()
  const all = () => [...byPath.values()]
  return {
    get: (name) => all().find((project) => project.name === name),
    all,
    forget: (name) => {
      for (const [list, project] of byPath) if (project.name === name) byPath.delete(list)
    },
    open: (list, registered) => {
      const existing = byPath.get(list)
      if (existing !== undefined) return existing
      const taken = new Set([...registered, ...all().map((project) => project.name)])
      const project: Project = {
        name: uniqueName(nameForList(list) ?? "list", taken),
        kind: fsSource.kind,
        registered: false,
        dir: undefined,
        config: { _tag: "Valid", source: fsSource, value: { path: list } },
      }
      byPath.set(list, project)
      return project
    },
  }
}

/** What resolution needs from the hub. */
export interface Resolution {
  readonly registered: Effect.Effect<ReadonlyArray<Project>, RegistryError>
  find(name: string): Effect.Effect<Project, ProjectNotFound | RegistryError>
  readonly unregistered: Unregistered
}

/**
 * The current project: `project` by name; else an unregistered fs project over
 * `dir`; else the list discovered from `cwd`, which is a registered project if
 * one's source owns it and an unregistered one otherwise.
 */
export const resolveProject = (
  at: ResolveInput,
  hub: Resolution,
): Effect.Effect<Project, ProjectNotFound | RegistryError | NoListFound | StoreError, SourceEnv> =>
  Effect.gen(function* () {
    if (at.project !== undefined) return yield* hub.find(at.project)
    const path = yield* Path.Path
    // A broken registry must not break unregistered lists: it only costs matches and names.
    const registered = yield* hub.registered.pipe(Effect.orElseSucceed(() => []))
    const open = (list: string) =>
      hub.unregistered.open(
        list,
        registered.map((project) => project.name),
      )
    if (at.dir !== undefined) return open(path.resolve(at.cwd, at.dir))
    const root = yield* findListRoot(at.cwd)
    if (Option.isNone(root)) return yield* new NoListFound({ cwd: at.cwd })
    for (const project of registered) {
      const { config } = project
      if (config._tag !== "Valid" || config.source.owns === undefined) continue
      if (yield* config.source.owns(config.value, root.value)) return project
    }
    return open(root.value)
  })
```

An unregistered project's config is the list root itself (`{ path: root }`); `fsSource.open` then finds `TODO.md` right there (a `todo/todo/TODO.md` would be unusual), so discovery and opening agree. Unregistered projects always use the hub's own `fsSource`, even when a frontend did not pass it in `sources`.

`src/hub/Hub.ts` — nine edits:

1. Imports. After `import { TodoService } from "../core/index.ts"` add:

   ```ts
   import type { StoreError } from "../spec/index.ts"
   ```

   In the `./errors.ts` import, add `type NoListFound,` after `type InvalidProjectConfig,`:

   ```ts
   import {
     type InvalidProjectConfig,
     type NoListFound,
     ProjectNotFound,
     RegistryError,
     type SourceError,
     SourceUnavailable,
   } from "./errors.ts"
   ```

   After `import { makeRegistry } from "./registry.ts"` add:

   ```ts
   import { makeUnregistered, type ResolveInput, resolveProject } from "./resolve.ts"
   ```

2. The `projects()` doc comment in the service interface becomes:

   ```ts
       /** Registered projects in registry order, then unregistered ones opened in this hub. */
   ```

3. In the service interface, after `rename(…)`, add:

   ```ts
       resolve(
         at: ResolveInput,
       ): Effect.Effect<ProjectInfo, ProjectNotFound | NoListFound | RegistryError | StoreError>
   ```

4. After `const registry = yield* makeRegistry(options.home)` add:

   ```ts
       const unregistered = makeUnregistered()
   ```

5. Replace `find` with:

   ```ts
       // Unregistered names never collide with registered ones when opened, so they are checked first.
       const find = (name: string): Effect.Effect<Project, ProjectNotFound | RegistryError> => {
         const open = unregistered.get(name)
         if (open !== undefined) return Effect.succeed(open)
         return registered.pipe(
           Effect.flatMap((projects) => {
             const found = projects.find((project) => project.name === name)
             return found === undefined
               ? Effect.fail(new ProjectNotFound({ name }))
               : Effect.succeed(found)
           }),
         )
       }
   ```

6. Replace `projects` with:

   ```ts
         projects: () =>
           Effect.map(registered, (projects) => [...projects, ...unregistered.all()].map(infoOf)),
   ```

7. In `add`, just before `yield* services.invalidate(name)`, add:

   ```ts
             unregistered.forget(name)
   ```

8. In `rename`, just before `yield* services.invalidate(from)`, add:

   ```ts
             unregistered.forget(to)
   ```

9. Before `todo: (name) =>`, add:

   ```ts
         resolve: (at) =>
           inEnv(resolveProject(at, { registered, find, unregistered })).pipe(Effect.map(infoOf)),

   ```

`src/hub/index.ts` becomes:

```ts
export * from "./errors.ts"
export { Hub, type HubOptions } from "./Hub.ts"
export { type AddInput, type ProjectInputOptions, projectInput } from "./input.ts"
export { isValidName } from "./names.ts"
export type { ResolveInput } from "./resolve.ts"
export type {
  AnySource,
  ProjectInfo,
  ProjectStatus,
  Source,
  SourceEnv,
  SourceProject,
  SyncOutcome,
} from "./Source.ts"
export { FsConfig, fsSource } from "./sources/fs.ts"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/hub`
Expected: PASS — every hub test file (errors, names, registry, fs, testing, input, Hub, resolve, index).

- [ ] **Step 5: Run the gate**

Run: `bun run fix && bun run check`
Expected: all green (at the time of writing: 461 tests across 62 files).

- [ ] **Step 6: Commit**

```bash
git add src/hub test/hub
git commit -F - <<'EOF'
Resolve the current project in the hub

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JAbSVu93PGiq8VsggEEchV
EOF
```

---

### Task 7: Docs, and close task 14

**Files:**
- Create: `src/hub/README.md`
- Modify: `docs/architecture/hub.md`, `docs/architecture/sources.md`, `docs/architecture/README.md`, `README.md`, `todo/hub-and-sources/15-add-sync-status-changes-and-overview-to-the-hub.md`

**Interfaces:** none (docs only). Every name below must match Tasks 1–6.

- [ ] **Step 1: Write `src/hub/README.md`**

````markdown
# @lemol/todo-md/hub

The in-process library every frontend uses to reach **projects**: todo lists
registered in `~/.todo-md/projects.yaml`, or found from the working
directory, each backed by a **source**. It is an SDK, not a server: every
process builds its own `Hub` over the shared home.

> Status: registry, resolution and per-project services (task 14). Sync,
> status, changes, `overview` and qualified references come in task 15.

## Contents

| Export | What it is |
| --- | --- |
| `Hub` | A `Context.Service`: `projects`, `add`, `remove`, `rename`, `resolve`, `todo`. |
| `Hub.layer({ home, userHome, sources })` | Builds the hub. Requires Effect's `FileSystem` and `Path`. Apps pass `home` as `$TODO_MD_HOME`, else `<userHome>/.todo-md`; `userHome` expands `~` in registry values. Dies if two sources share a kind. |
| `Source<C>`, `AnySource`, `SourceProject<C>`, `SourceEnv` | The source interface (below). |
| `ProjectInfo`, `ProjectStatus`, `SyncOutcome` | What frontends see. `status` is `{ result: "never" }` until task 15, or `{ result: "error", error }` for a broken entry. |
| `fsSource`, `FsConfig` | Local lists: `{ path }`, an absolute path (or `~/…`). |
| `projectInput(target, { cwd, source?, name? })` | What a user types (a path or URL) as `add`'s input (`AddInput`): git URLs (`git@…`, `ssh://…`, `https://….git`, `github.com/…`) are `git` with `{ url }`; anything else is `fs` with `{ path }` resolved against `cwd`. |
| `isValidName` | The name rule, `[a-z0-9][a-z0-9-]*`. |
| Errors | `ProjectNotFound`, `NoListFound`, `InvalidProjectConfig`, `SourceUnavailable`, `SourceError`, `RegistryError`, and `SyncError` (for `Source.sync`). Each has a readable `message`. |
| `@lemol/todo-md/hub/testing` | `memorySource(hooks?)`, for tests only. |

## The hub

| Method | Behavior |
| --- | --- |
| `projects()` | Registered projects in registry order, then the unregistered projects opened in this hub. A broken entry (unknown source, rejected config) is listed with an error status; the others still load. |
| `add({ name?, source, config })` | Validates `config` with the source's schema (after `~` expansion). The name defaults to the source's `defaultName`. Creates `<home>/projects/<name>/`, runs `prepare`, then writes the entry as given. On failure, neither the entry nor the directory stays. |
| `remove(name, { force? })` | Runs `beforeRemove` (which may refuse), then deletes the entry and the data directory. Works on broken entries too. |
| `rename(from, to)` | Renames the entry in place, keeping its comments, and moves the data directory. |
| `resolve({ project?, dir?, cwd })` | The current project (below). |
| `todo(name)` | `core`'s `TodoService` over the project's store, built on first use and cached per name (`LayerMap`). Registry changes made through this hub drop the cached service; a failed open is not cached, so the next call retries. |

Error unions are wider than the design's sketch: `todo` can also fail with
`InvalidProjectConfig` or `RegistryError`, and `resolve` with `RegistryError`
or `StoreError` (discovery I/O).

## The registry

`<home>/projects.yaml`:

```yaml
projects:
  todo-md:
    source: fs
    path: ~/code/todo-md
```

- A missing file is an empty registry; the home is created on the first
  write.
- Edits use yaml's `Document` API, so comments and order survive. Each edit
  takes `<home>/.todo.lock` (`fs`'s `makeLock`), re-reads the file, then
  writes `projects.yaml.tmp` and renames it over. Nothing is written from a
  stale document.
- Unparsable YAML, a top level that is not a map, or `projects` that is not
  a map fail reads with `RegistryError`. A bad entry never does.
- `~` or `~/…` at the start of a top-level string value expands to
  `userHome` before the source sees it.

## Resolution

1. `project`: a registered project, or an unregistered one open in this hub;
   otherwise `ProjectNotFound`.
2. `dir`: an unregistered fs project over `path.resolve(cwd, dir)`.
3. Otherwise `findListRoot(cwd)` (`NoListFound` when there is none): the
   first registered project whose source `owns` that list root, else an
   unregistered project.

- Frontends reject `project` and `dir` together as a usage error before
  calling; if both arrive anyway, `project` wins.
- Unregistered projects use `fsSource`, have no data directory and live as
  long as the hub. They are named after their project directory (the parent
  of `todo/`), slugged (`My Tool` → `my-tool`), with `-2`, `-3`… when the
  name is taken.
- A broken registry does not stop `dir` or discovery; it only loses matches
  with registered projects.
- `dir` goes through `fsSource`, which prefers `<dir>/todo/TODO.md` over
  `<dir>/TODO.md`. Today's CLI `--dir` opens `<dir>/TODO.md`; the two differ
  only for a directory holding both (task 16 decides).

## Sources

The interface is in [`Source.ts`](./Source.ts) and
[docs/architecture/sources.md](../../docs/architecture/sources.md).

- Sources are plain values. The hub provides `SourceEnv` (`FileSystem` and
  `Path`) to every source call; any other service must be provided when the
  value is built.
- `owns` is an effect, because comparing list roots reads the disk.
- `SourceProject.dir` is `undefined` for unregistered projects.
- **fs:** `open` uses `<path>/todo` if it has a `TODO.md`, else `<path>`,
  without walking up (`SourceError` "no TODO.md at …" otherwise); `owns`
  compares that root with the discovered one; `defaultName` is the project
  directory's basename. No `prepare`, no `sync`; `changes` comes in task 15.

## Testing

- `memorySource(hooks?)`: kind `memory`, config `{ title?, tasks? }`. Each
  project's `MemoryTodoStore` is seeded from `tasks` on first open and kept
  by name for as long as the source value lives. `hooks` add `prepare`,
  `beforeRemove`, `sync`, `changes`, `status`, `owns` or `defaultName`.
- `test/hub` runs hubs over temporary homes (`hubOn` in
  `test/hub/helpers.ts`); two hubs on one disk share a home like two
  processes. Tests that contend for the lock use the real clock.

## May import (enforced by `test/boundaries.test.ts`)

- [`spec`](../spec), [`core`](../core), [`fs`](../fs)
- `effect`, `yaml`

No Bun or Node APIs. `testing.ts` is for tests only.

## Not here

- Sync, status, changes, `overview`, refs: task 15.
- The git and jira sources: `src/git`, `src/jira` (tasks 19 and 06).
- Frontend wiring: tasks 16–18.
````

- [ ] **Step 2: Update `docs/architecture/hub.md`**

Replace the status banner (lines 3–6) with:

```markdown
> **Status: partly built.** Task 14 built the registry, resolution and the
> per-project services ([`src/hub`](../../src/hub/README.md)). Task 15 adds
> sync, status, changes, `overview` and qualified references. The full design,
> with the reasons behind each choice, is in the
> [hub design](../superpowers/specs/2026-09-13-hub-design.md).
```

In "What it owns", mark what is still to come: append ` *(task 15)*` to the bullets **Sync and status**, **Changes**, **Cross-project queries** and **Qualified references**, and change the **Project data directories** bullet to:

```markdown
- **Project data directories**, `~/.todo-md/projects/<name>/`: whatever the
  source keeps there (a clone, a mirror), plus `state.json` (sync status,
  task 15).
```

Replace the "Boundaries" section with:

```markdown
## Boundaries

- May import `spec`, `core`, `fs`, `effect` and `yaml`. It never imports
  another source's module; sources are passed in:
  `Hub.layer({ home, userHome, sources })` (`autoSync` comes in task 15).
- No Bun or Node APIs: it uses Effect's `FileSystem` and `Path`, provides
  both to every source call (`SourceEnv`), and takes `home` and `userHome`
  as parameters.
- `@lemol/todo-md/hub/testing` exports `memorySource` for tests.
```

- [ ] **Step 3: Update `docs/architecture/sources.md`**

Replace the status banner (lines 3–6) with:

```markdown
> **Status: fs built (task 14).** git (task 19) and jira (task 06) are
> planned; each updates this page. The full design is in the
> [hub design](../superpowers/specs/2026-09-13-hub-design.md#4-sources).
```

Replace the interface code block under "The interface" with the built one:

```ts
type SourceEnv = FileSystem | Path            // provided by the hub

interface Source<C> {
  readonly kind: string
  readonly config: Schema.Codec<C, unknown>
  defaultName?(config: C): string | undefined
  location(config: C): string
  prepare?(p: SourceProject<C>): Effect<void, SourceError, SourceEnv>
  open(p: SourceProject<C>): Layer<TodoStore, SourceError, SourceEnv>
  sync?(p: SourceProject<C>): Effect<SyncOutcome, SyncError, SourceEnv>
  changes?(p: SourceProject<C>): Stream<void, never, SourceEnv>
  status?(p: SourceProject<C>): Effect<Partial<ProjectStatus>, never, SourceEnv>
  beforeRemove?(p: SourceProject<C>, force: boolean): Effect<void, SourceError, SourceEnv>
  owns?(config: C, listRoot: string): Effect<boolean, never, SourceEnv>
}

interface SourceProject<C> {
  readonly name: string
  readonly config: C
  readonly dir: string | undefined  // undefined for unregistered projects
}
```

and add these bullets at the top of the list that follows it:

```markdown
- The hub provides `FileSystem` and `Path` (`SourceEnv`) to every call, so
  `fsSource` is a plain value. `owns` is an effect because comparing list
  roots reads the disk.
- The hub expands `~` in top-level string fields before `config` decodes
  them.
```

- [ ] **Step 4: Update `docs/architecture/README.md`**

- Topic table: `*(planned)*` on the hub row becomes `*(partly built)*`; on the Sources row, `*(fs built)*`.
- Module table: replace the `src/hub` row and add a `hub/testing` row after it:

  ```markdown
  | [`src/hub`](../../src/hub)           | `@lemol/todo-md/hub`           | spec, core, fs, `effect`, `yaml`         | Projects: registry, resolution, a `TodoService` per project; the `Source` interface and `fsSource` (sync, changes and cross-project queries: task 15) |
  |                                 | `@lemol/todo-md/hub/testing`   | hub, spec                                | `memorySource`, for tests only                                                  |
  ```

- In the `src/cli` row, "May import" becomes `spec, core, fs, hub, \`effect\`, \`@effect/platform-bun\`, \`node:*\`, \`bun\``.
- The dependency rule "Runtime code never imports `spec/testing`." becomes "Runtime code never imports `spec/testing` or `hub/testing`."

- [ ] **Step 5: Update the root `README.md` package table**

After the `@lemol/todo-md/fs` row, add:

```markdown
| [`@lemol/todo-md/hub`](src/hub)                    | Projects: registry, resolution, a service per project (`hub/testing`: `memorySource`) |
```

- [ ] **Step 6: Tell task 15 what already exists**

In `todo/hub-and-sources/15-add-sync-status-changes-and-overview-to-the-hub.md`, after the `Out: …` paragraph of `## Scope`, add:

```markdown
Already there from task 14: `SyncError` (`{ project, reason, message }`) and
`SyncOutcome` are declared, because `Source.sync` names them;
`memorySource(hooks)` accepts `sync`, `changes` and `status` hooks; sources
receive `FileSystem` and `Path` from the hub (`SourceEnv`). See
[`src/hub/README.md`](../../src/hub/README.md).
```

- [ ] **Step 7: Run the gate**

Run: `bun run fix && bun run check`
Expected: all green. Also confirm the CLI still behaves as before: `bun src/cli/bin.ts next` prints this repository's next tasks.

- [ ] **Step 8: Mark task 14 done and commit**

```bash
bun src/cli/bin.ts done 14
git add -A src/hub docs README.md todo
git commit -F - <<'EOF'
Document the hub and close task 14

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JAbSVu93PGiq8VsggEEchV
EOF
```

`todo done 14` moves the task file into `todo/done/` and unblocks task 15; `git add -A todo` stages the move.

---

## Acceptance (from task 14)

- `Hub.layer` works over a temporary home with `fsSource` and `memorySource` (Tasks 5–6 tests).
- Nothing in the CLI or web app changes behavior (the existing suites pass unchanged; only `NoListFound` moved, re-exported).
- `bun run check` passes.
