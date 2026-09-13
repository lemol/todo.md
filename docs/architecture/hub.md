# hub

> **Status: partly built.** Task 14 built the registry, resolution and the
> per-project services ([`src/hub`](../../src/hub/README.md)). Task 15 adds
> sync, status, changes, `overview` and qualified references. The full design,
> with the reasons behind each choice, is in the
> [hub design](../superpowers/specs/2026-09-13-hub-design.md).

`hub` (`@lemol/todo-md/hub`) is an in-process library that every frontend
(CLI, web app, TUI) uses to reach **projects**: registered todo lists backed
by a **source** ([sources.md](./sources.md)). It is not an HTTP server; each
process creates its own hub over shared state in `~/.todo-md`.

## What it owns

- **The registry**, `~/.todo-md/projects.yaml`: a hand-editable map from
  project name to `{ source, …config }`. Writes keep comments, are atomic and
  run under `~/.todo-md/.todo.lock`. Secrets are referenced (`token_env`,
  `token_command`), never stored.
- **Project data directories**, `~/.todo-md/projects/<name>/`: whatever the
  source keeps there (a clone, a mirror), plus `state.json` (sync status,
  task 15).
- **Resolution** of the current project, shared by every frontend:
  `--project`, else `--dir` (an unregistered fs project), else discovery
  from the working directory, matched against registered fs projects.
- **Per-project services:** `hub.todo(name)` returns `core`'s `TodoService`
  over the project's store. Layers are built lazily and cached (`LayerMap`).
- **Sync and status** *(task 15)*: `sync`, `syncAll` and an optional
  `autoSync` interval for long-running hosts. Reads never sync.
- **Changes** *(task 15)*: a lazy `Stream` merging the sources' replica
  watches, the hub's own events and a watch on `projects.yaml`.
- **Cross-project queries** *(task 15)*: `overview({ projects?, sources?,
  filter? })` fans `list(filter)` out across projects and isolates failures
  per project.
- **Qualified references** *(task 15)*: `<project>:<id>`, with
  `parseRef`/`formatRef`.

## Layout

```
~/.todo-md/                ($TODO_MD_HOME overrides it)
  projects.yaml
  .todo.lock
  projects/<name>/
    state.json
    …                      the source's files
```

## Boundaries

- May import `spec`, `core`, `fs`, `effect` and `yaml`. It never imports
  another source's module; sources are passed in:
  `Hub.layer({ home, userHome, sources })` (`autoSync` comes in task 15).
- No Bun or Node APIs: it uses Effect's `FileSystem` and `Path`, provides
  both to every source call (`SourceEnv`), and takes `home` and `userHome`
  as parameters.
- `@lemol/todo-md/hub/testing` exports `memorySource` for tests.
