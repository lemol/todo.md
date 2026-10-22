# @lemol/todo-md/hub

The in-process library every frontend uses to reach **projects**: todo lists
registered in `~/.todo-md/projects.yaml`, or found from the working
directory, each backed by a **source**. It is an SDK, not a server: every
process builds its own `Hub` over the shared home.

> Status: built (tasks 14, 15 and 19). The jira source comes in task 06; frontends move onto the hub in tasks 16–18.

## Contents

| Export | What it is |
| --- | --- |
| `Hub` | A `Context.Service`: `projects`, `add`, `remove`, `rename`, `resolve`, `todo`, `status`, `sync`, `syncAll`, `overview`, `changes`. |
| `Hub.layer({ home, userHome, sources, autoSync? })` | Builds the hub. Requires Effect's `FileSystem` and `Path`. Apps pass `home` as `$TODO_MD_HOME`, else `<userHome>/.todo-md`; `userHome` expands `~` in registry values. `autoSync` optionally runs `syncAll` periodically. Dies if two sources share a kind. |
| `Source<C>`, `AnySource`, `SourceProject<C>`, `SourceEnv` | The source interface (below). |
| `ProjectInfo`, `ProjectStatus`, `SyncOutcome` | What frontends see. `status` is its last sync (`state.json`) overlaid with the source's live fields, or `{ result: "error", error }` for a broken entry. |
| `SyncResult`, `SyncFailure` | The outcome of a sync operation; `SyncFailure` is `{ project, error }` (told apart with `"error" in outcome`). |
| `HubChange` | Events emitted by `hub.changes`: `changed`, `synced`, `registry`. |
| `Overview`, `OverviewQuery`, `OverviewEntry`, `OverviewTask`, `OverviewError` | Cross-project query types. |
| `formatRef`, `parseRef`, `TaskRef` | Qualified task reference helpers (`<project>:<id>`). |
| `makeDependencyResolver(project, deps)` | The `DependencyResolver` each `hub.todo` service gets: readiness and diagnostics for `<project>:<id>` entries across registered projects, warning (never failing) on unresolvable ones, with cross-project cycle detection. |
| `fsSource`, `FsConfig` | Local lists: `{ path }`, an absolute path (or `~/…`). Opens an `FsTodoStore` that caches parses in `<home>/cache`. |
| `watchList(root, { ignore?, recursive? })` | Watches a list directory (debounced 100 ms, ignoring locks and tmp files; recursive by default). `ignore` skips further event paths, as [`git`](../git) does for `.git`. |
| `projectInput(target, { cwd, source?, name?, path?, branch?, list? })` | What a user types (a path or URL) as `add`'s input (`AddInput`): a sqlite target is the project's name; git URLs (`git@…`, `ssh://…`, `https://….git`, `github.com/…`) are `git` with `{ url }`, plus `branch` and `list` when given; anything else is `fs` with `{ path }` resolved against `cwd`. `path` passes through to sqlite. |
| `projectInputFrom(target, options, resolve)` | The same rules without `Path`; frontends pass a `resolve(cwd, path)` callback. |
| `statusText` | A `ProjectStatus` as one line for people, shared by every frontend (`status.ts`). |
| `isValidName`, `nameFrom` | The name rule, `[a-z0-9][a-z0-9-]*`, and free text turned into one. |
| Errors | `ProjectNotFound`, `NoListFound`, `InvalidProjectConfig`, `SourceUnavailable`, `SourceError`, `RegistryError`, and `SyncError` (for `Source.sync`). Each has a readable `message`. |
| `@lemol/todo-md/hub/testing` | `memorySource(hooks?)`, for tests only. |

## The hub

| Method | Behavior |
| --- | --- |
| `projects()` | Registered projects in registry order, then the unregistered projects opened in this hub. A broken entry (unknown source, rejected config, invalid name) is listed with an error status; the others still load. |
| `add({ name?, source, config })` | Validates `config` with the source's schema (after `~` expansion). The name defaults to the source's `defaultName`. Creates `<home>/projects/<name>/` exclusively — an existing directory is a `RegistryError` naming it, and nothing is deleted — then runs `prepare`, then writes the entry as given. On failure after that, only the directory this call created is removed; the entry never stays. Registering a list that is already open unregistered replaces that entry: `add` asks the source `owns(config, list)` for each open list and forgets the match, so the same list is never two projects. |
| `remove(name, { force? })` | Runs `beforeRemove` (which may refuse), then deletes the entry and, under the lock, moves the data directory aside to `projects/.removed-<name>-<token>`; after the write it deletes that. Works on broken entries too: there is no source to ask, so a broken entry with a non-empty data directory needs `force` rather than having its only copy of something deleted. An entry with an invalid name has no data directory to delete. |
| `rename(from, to)` | Renames the entry in place, keeping its comments, and moves the data directory. An existing `projects/<to>` directory is refused, like in `add`. An entry with an invalid name can be renamed, to repair it. |
| `resolve({ project?, dir?, cwd })` | The current project (below). |
| `todo(name)` | looks the project up on every call and rebuilds the cached service when its entry changed, even from another process. Call `todo` per operation rather than holding a service across registry changes: a rebuild closes the old service's scope. |
| `status(name)` | Persisted `state.json` overlaid with the source's live status fields (such as git's `ahead`); missing state is `{ result: "never" }`, unreadable is `{ result: "error" }`. A defect in `source.status` is logged and left out. |
| `sync(name)` | Runs `source.sync` behind a per-project semaphore, writes `state.json`, and publishes `synced`. A source without `sync` returns `{ summary: "nothing to sync" }` and writes/publishes nothing. |
| `syncAll()` | Runs `sync` across every registered, syncable project at concurrency 4, returning an array of `SyncResult \| SyncFailure` in registry order. Fails only for an unreadable registry. |
| `overview(query?)` | Cross-project query across projects (default: all registered projects) at concurrency 4. Isolates failures per project and returns flattened `tasks` with qualified refs. |
| `changes` | Lazy, reference-counted `Stream<HubChange>` combining replica watches, registry edits, sync completions, and mutations on sources without native change streams. |

Error unions are wider than the design's sketch, like task 14's: `todo` can fail
with `InvalidProjectConfig` or `RegistryError`; `resolve` with `RegistryError`
or `StoreError` (discovery I/O); `status` can fail with `RegistryError`; `sync`
with `InvalidProjectConfig`, `SourceUnavailable` and `RegistryError`; `syncAll`
fails only with `RegistryError` (an unreadable registry), never for a project.
`overview`'s query is optional.

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
  takes `<home>/.todo.lock` (`spec`'s `makeLock`, through `fs`), re-reads the file, then
  writes `projects.yaml.tmp` and renames it over. Nothing is written from a
  stale document.
- Unparsable YAML, a top level that is not a map, or `projects` that is not
  a map fail reads with `RegistryError`, as does an alias to a missing anchor
  or an alias bomb. A resolving alias is fine as an entry's value (`q: *b`)
  but not as `projects` itself (`projects: *x` fails with "projects must be a
  map, not an alias"); the message names the file and the error's first line.
  An edit that would leave an unresolved alias (deleting an anchor another
  entry still uses) fails the write with "the edit would leave alias *b
  unresolved", and the file is unchanged. A bad entry never does.
- Names are validated on read too: a key that is not a valid name (`My App`,
  `..`) is listed as a broken entry, with no data directory.
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

## Status and sync

- **`state.json`:** located at `<home>/projects/<name>/state.json`, shaped `{ version: 1, lastSync?, result, error?, diverged? }`. Written atomically via a temporary file and rename, uninterruptibly: interrupting a sync (hub shutdown, `autoSync` stopping) waits for a write it started, so no temporary file or half-written directory outlives it; created with the data directory if missing.
- **State reads:** a missing `state.json` yields `{ result: "never" }`; an unreadable or invalid file yields `{ result: "error", error }`.
- **Live status overlay:** fields from `source.status` (such as `ahead`, `behind`) override `state.json`. A defect in `source.status` is logged at debug level and ignored.
- **`sync` execution:**
  - When the source has no `sync`, returns `{ summary: "nothing to sync" }`; nothing is written to state and no event is published.
  - Syncs are serialized per project with a `Semaphore`.
  - On success, writes `{ lastSync: now, result: "ok", diverged: false }`.
  - On `SyncError`, writes `{ lastSync: now, result: "error", error: message, diverged: reason === "diverged" }`, then fails with the `SyncError`.
  - State file write failures are logged and do not alter the sync result.
  - `{ kind: "synced", project }` is published after either success or failure.
- **`syncAll`:** runs `sync` over all registered, syncable projects at concurrency 4. Returns an array of `SyncResult | SyncFailure` in registry order; fails only if the registry cannot be read (`RegistryError`).
- **`autoSync`:** optional `Duration` passed to `Hub.layer`. When set, a scoped fiber runs `syncAll` periodically in the background.

## Changes

- **Lazy and reference-counted:** watchers start only when the first subscriber opens `hub.changes` and stop when the last subscriber leaves.
- **What is watched:** every registered project whose source implements `changes`, plus unregistered projects opened via `resolve`. Watchers are re-evaluated on registry changes and resolutions; updating a project's entry restarts its watcher.
- **Registry watch:** watches `<home>/projects.yaml` (debounced 100 ms; creates `<home>` on startup if missing). In addition to emitting `{ kind: "registry" }`, it invalidates cached services for any entries that were modified or removed.
- **Own mutations:** publishing `{ kind: "changed", project }` occurs after successful mutations through `hub.todo` for sources without a native `changes` stream.
- **Registry events:** published immediately after this hub's own registry writes, and may be repeated when the file watch detects the write.
- **Watcher resilience:** if a project watcher fails (for example, if a list directory is deleted), that watcher ends with a warning log while the overall `changes` stream continues.

## Overview

- **Target projects:** defaults to all registered projects in registry order. Explicit `projects` list preserves given order, allows unregistered projects opened in the hub, and treats unknown names as placeholder `ProjectInfo` (`source: ""`, `location: ""`, `registered: false`, error status) paired with `ProjectNotFound`.
- **Filtering:** the `sources` option filters projects by source kind, but never drops unknown project names.
- **Concurrency:** queries projects at concurrency 4 via `hub.todo(name)` followed by `list(filter)`.
- **Tasks and refs:** returns flattened `tasks` in project order, ordered by priority within each project (open tasks by section, followed by completed tasks when included), with refs qualified as `formatRef(project, id)`.

## References

- **Format and parse:** `formatRef(project, id)` yields `<project>:<id>`. `parseRef(text)` splits at the first `:` if the left side is a valid project name (`isValidName`) and the right side is non-empty; otherwise the entire text is treated as an ID.
- **Examples:**
  - `formatRef("todo-md", "12")` → `"todo-md:12"`
  - `formatRef("work", "PROJ-7")` → `"work:PROJ-7"`
  - `parseRef("todo-md:12")` → `{ project: "todo-md", id: "12" }`
  - `parseRef("work:PROJ-7")` → `{ project: "work", id: "PROJ-7" }`
  - `parseRef("a:b:c")` → `{ project: "a", id: "b:c" }`
  - `parseRef("12")` → `{ id: "12" }`
  - `parseRef("007")` → `{ id: "007" }`
  - `parseRef("My App:1")` → `{ id: "My App:1" }`
  - `parseRef(":1")` → `{ id: ":1" }`
  - `parseRef("work:")` → `{ id: "work:" }`

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
  directory's basename. No `prepare`, no `sync`. Its change stream uses
  `watchList(root)` (recursive watch debounced 100 ms, ignoring `.todo.lock`
  and `*.tmp`; a missing list ends the stream with a warning).

## Testing

- `memorySource(hooks?)`: kind `memory` (configurable via hook), config `{ title?, tasks? }`. Each
  project's `MemoryTodoStore` is seeded from `tasks` on first open and kept
  by name for as long as the source value lives. `hooks` add `kind`, `prepare`,
  `beforeRemove`, `sync`, `changes`, `status`, `owns` or `defaultName`.
- `test/hub` runs hubs over temporary homes (`hubOn` in
  `test/hub/helpers.ts`); two hubs on one disk share a home like two
  processes. Tests that contend for the lock use the real clock.
  `test/hub/helpers.ts` also provides `liveTest` (real clock), `takeWithin`,
  `eventually` (repeats a change until a watch detects it), `makeWatchers` and `listen`.

## May import (enforced by `test/boundaries.test.ts`)

- [`spec`](../spec), [`core`](../core), [`fs`](../fs)
- `effect`, `yaml`

No Bun or Node APIs. `testing.ts` is for tests only.

## Not here

- The git source: [`src/git`](../git). The jira source: [`src/jira`](../jira). The sqlite source: [`src/sqlite`](../sqlite).
- Frontend wiring: tasks 16–18.
