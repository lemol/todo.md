---
title: "Build the hub: registry, resolution and project services"
tags: [hub]
---
## Goal

Create `src/hub` (`@lemol/todo-md/hub`): the in-process library every
frontend will use to reach projects. This task builds the foundation:
the `Source` interface, the registry in `~/.todo-md`, resolution of the
current project, per-project `TodoService`s and `fsSource`. Sync, status,
changes and `overview` come in task 15.

Design: [hub design §1–4](../../docs/superpowers/specs/2026-09-13-hub-design.md),
[docs/architecture/hub.md](../../docs/architecture/hub.md).

## Scope

In:

- Module scaffolding, package exports `./hub` and `./hub/testing`,
  boundaries rules.
- `Source`, `SourceProject`, `ProjectInfo`, `ProjectStatus` types and the
  hub errors.
- The registry: read, validate, add, remove, rename, with comments
  preserved.
- `resolve`, `todo`, `projects`.
- `fsSource` without `changes`; `memorySource` in `hub/testing`.
- `projectInput(target, options)`: turns what a user types (a path or URL)
  into `{ source, config }`, for the CLI (task 16) and web (task 18).

Out (task 15): `state.json`, `status`, `sync`, `syncAll`, `autoSync`,
`changes`, `overview`, `parseRef`/`formatRef`. Until then
`ProjectInfo.status` is `{ result: "never" }`.

## Design

**Layer.** `Hub.layer({ home, userHome, sources })` builds the `Hub`
service; it requires `FileSystem` and `Path` only. `home` is the
`~/.todo-md` directory (apps pass `$TODO_MD_HOME` or `<userHome>/.todo-md`);
`userHome` expands `~` in registry paths.

**Source interface** (`src/hub/Source.ts`), exactly as in the design:
`kind`, `config` (a `Schema.Codec`), `defaultName?`, `location`,
`prepare?`, `open`, `sync?`, `changes?`, `status?`, `beforeRemove?`,
`owns?`. Sources are plain values; the hub keeps a `Map` from kind to
source and rejects duplicate kinds when the layer is built.

**Registry** (`src/hub/registry.ts`):

- File: `<home>/projects.yaml`, top-level key `projects`, a map from name
  to `{ source, ...config }`. A missing file is an empty registry. The home
  directory is created on first write.
- Parse with `yaml`'s `parseDocument`; keep the `Document` to edit, so
  comments and order survive (`doc.setIn`, `doc.deleteIn`; rename rebuilds
  the pair in place to keep its position).
- Name rule: `[a-z0-9][a-z0-9-]*`. Invalid names or duplicates are
  `RegistryError`s on write.
- Reading never fails because of one bad entry: an unknown source kind
  yields a project with `status.result: "error"` and
  `SourceUnavailable`'s message; a config the source's schema rejects
  yields `InvalidProjectConfig`'s message. Only unreadable or unparsable
  YAML fails the whole read (`RegistryError`).
- Writes: under `makeLock(home)` (from `fs`, see below), re-read the file,
  apply the edit, write `projects.yaml.tmp`, rename over. Never write from
  a stale in-memory document.
- `add({ name?, source, config })`: validate config with the source's
  schema; name = given, else `source.defaultName(config)`, else
  `RegistryError` ("a name is required"); create `<home>/projects/<name>/`;
  run `source.prepare` if present (on failure remove the directory and the
  entry, and fail with `SourceError`); then write the entry.
- `remove(name, { force })`: `source.beforeRemove(p, force)` if present,
  then delete the entry, then delete `<home>/projects/<name>/`.
- `rename(from, to)`: rename the entry and move the data directory;
  invalidate cached layers for both names.

**Export the fs lock.** `src/fs/index.ts` exports `makeLock`, `Lock` and
`defaultLockOptions` from `lock.ts`, so the hub (registry) and git (clone)
reuse it. Its lock file name `.todo.lock` stays. Document it in
`src/fs/README.md`.

**Resolution** (`hub.resolve({ project?, dir?, cwd })`):

1. `project`: registry lookup, else `ProjectNotFound`.
2. `dir`: an unregistered fs project over `path.resolve(cwd, dir)`.
3. Else `findListRoot(cwd)`; `NoListFound` when none (reuse the CLI's
   message text: move `NoListFound` from `src/cli/errors.ts` into the hub,
   re-exported by the CLI). If a registered project's source `owns` the
   found list root, that project; otherwise an unregistered project.

Frontends reject `project` and `dir` together as a usage error before
calling `resolve`; if both arrive anyway, `project` wins. Document it.

Unregistered projects: named after the list's project directory (the
parent of `todo/` if the root ends in `/todo`), with `-2`, `-3`… if the name
is taken; kept in an in-memory map for the hub's lifetime; no data
directory; `registered: false`.

**Per-project services** (`hub.todo(name)`): a `LayerMap` keyed by project
name whose layer is `TodoService.layer` provided with `source.open(p)`.
Registry changes made through this hub invalidate affected keys. Returns
`TodoService["Service"]` (which already carries `capabilities`).

**`fsSource`** (`src/hub/sources/fs.ts`): config `{ path }` (`~` expanded);
`defaultName` = basename of the project directory; `location` = the path;
`open` = `FsTodoStore.layer({ root })` where root is `<path>/todo` if
`<path>/todo/TODO.md` exists, else `<path>` if `<path>/TODO.md` exists,
else a `SourceError` ("no TODO.md at <path>"); `owns(config, listRoot)`
compares the resolved root. No `sync`, no `prepare`.

**`projectInput(target, { source?, name? })`**: `source` wins when given.
Otherwise `git@…`, `ssh://…`, `https://…​.git` and `github.com/…` (with or
without scheme) are `git` with `{ url }`; anything else is `fs` with
`{ path: target }` resolved against the caller's cwd. `git` configs are
passed through even if no git source is loaded (the hub then reports
`SourceUnavailable`).

**`memorySource`** (`src/hub/testing.ts`): kind `memory`, config
`{ tasks?: TaskInput[] }` or a named in-memory store per project; `open`
returns a `MemoryTodoStore` layer kept per project name so state persists
across `todo()` calls within a test; optional hooks (`sync`, `changes`) can
be configured by tests for task 15.

**Errors** (`src/hub/errors.ts`, `Schema.TaggedErrorClass` like
`src/spec/errors.ts`): `ProjectNotFound`, `NoListFound`,
`InvalidProjectConfig`, `SourceUnavailable`, `SourceError`,
`RegistryError`. `SyncError` comes in task 15.

## Files

- New: `src/hub/index.ts`, `Hub.ts`, `Source.ts`, `registry.ts`,
  `resolve.ts`, `errors.ts`, `input.ts`, `sources/fs.ts`, `testing.ts`,
  `README.md`
- `package.json` exports: `"./hub"`, `"./hub/testing"`
- `src/fs/index.ts`, `src/fs/README.md` (lock export)
- `src/cli/errors.ts` (`NoListFound` re-export)
- `test/boundaries.test.ts`: `hub: { modules: ["spec", "core", "fs"],
  packages: ["effect", "yaml"] }`; treat `hub/testing` like `spec/testing`
  (only tests and itself may import it); checker test cases for both
- `test/hub/*.test.ts`

## Tests

- Registry: empty home; add → file contents; a hand comment above an entry
  survives add, rename and remove; invalid name; duplicate name; unknown
  source kind and invalid config degrade to error-status projects while
  other projects load; concurrent adds from two hubs (two layers over one
  home) both land (the lock).
- `prepare` failure leaves neither entry nor directory.
- `beforeRemove` refusal keeps entry and directory.
- Rename moves the data directory; `todo(old)` fails afterwards,
  `todo(new)` works.
- Resolve: precedence, cwd inside a registered fs project, unregistered
  naming and suffixes, `NoListFound`.
- `todo(name)` twice returns services over the same store (memorySource
  state persists), and a real `FsTodoStore` project round-trips add/list.
- `projectInput` inference table.
- Boundaries test updated and passing.

## Docs

- `src/hub/README.md` in the style of the other module READMEs.
- `docs/architecture/hub.md`: replace the "planned" banner with the real
  status for what this task built (task 15 finishes it); module table row
  in `docs/architecture/README.md` loses "(planned)".
- Root `README.md` package table: add `@lemol/todo-md/hub`.

## Done when

- `Hub.layer` works over a temporary home with `fsSource` and
  `memorySource`.
- Nothing in the CLI or web app changes behavior yet.
- `bun run check` passes.
