# hub

> **Status: planned.** Nothing here is built yet. The full design, with the
> reasons behind each choice, is in the
> [hub design](../superpowers/specs/2026-09-13-hub-design.md). Tasks 14 and
> 15 build it; each updates this page to match the code.

`hub` (`@lemol/todo-md/hub`) is an in-process library that every frontend
(CLI, web app, TUI) uses to reach **projects**: registered todo lists backed
by a **source** ([sources.md](./sources.md)). It is not an HTTP server; each
process creates its own hub over shared state in `~/.todo-md`.

## What it owns

- **The registry**, `~/.todo-md/projects.yaml`: a hand-editable map from
  project name to `{ source, …config }`. Writes keep comments, are atomic and
  run under `~/.todo-md/.todo.lock`. Secrets are referenced (`token_env`,
  `token_command`), never stored.
- **Project data directories**, `~/.todo-md/projects/<name>/`: `state.json`
  (sync status) plus whatever the source keeps there (a clone, a mirror).
- **Resolution** of the current project, shared by every frontend:
  `--project`, else `--dir` (an unregistered fs project), else discovery
  from the working directory, matched against registered fs projects.
- **Per-project services:** `hub.todo(name)` returns `core`'s `TodoService`
  over the project's store. Layers are built lazily and cached (`LayerMap`).
- **Sync and status:** `sync`, `syncAll` and an optional `autoSync`
  interval for long-running hosts. Reads never sync.
- **Changes:** a lazy `Stream` merging the sources' replica watches, the
  hub's own events and a watch on `projects.yaml`.
- **Cross-project queries:** `overview({ projects?, sources?, filter? })`
  fans `list(filter)` out across projects and isolates failures per
  project.
- **Qualified references:** `<project>:<id>`, with `parseRef`/`formatRef`.

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
  `Hub.layer({ home, userHome, sources, autoSync? })`.
- No Bun or Node APIs: it uses Effect's `FileSystem` and `Path`, and takes
  `home` and `userHome` as parameters.
- `@lemol/todo-md/hub/testing` exports `memorySource` for tests.
