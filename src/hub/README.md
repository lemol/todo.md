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
| `add({ name?, source, config })` | Validates `config` with the source's schema (after `~` expansion). The name defaults to the source's `defaultName`. Creates `<home>/projects/<name>/` exclusively — an existing directory is a `RegistryError` naming it, and nothing is deleted — then runs `prepare`, then writes the entry as given. On failure after that, only the directory this call created is removed; the entry never stays. |
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
