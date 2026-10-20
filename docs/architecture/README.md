# Architecture

How the todo.md modules fit together and why they are split the way they
are. For what a task *is* and how the files look, see
[spec.md](../spec.md).

| Topic | File |
| --- | --- |
| The `TodoStore` contract, capabilities, conformance, writing an adapter | [contract.md](./contract.md) |
| `markdown` and `fs`: parsing, splicing writes, the write path, locking | [storage.md](./storage.md) |
| `hub`: projects, the registry, sync, changes, cross-project queries *(partly built)* | [hub.md](./hub.md) |
| Sources: fs, git, jira and sqlite behind the hub | [sources.md](./sources.md) |
| The CLI, the web app and the TUI as composition roots | [frontends.md](./frontends.md) |
| Packaging, the `effect` pin, testing and tooling | [tooling.md](./tooling.md) |
| Why things are the way they are | [decisions.md](./decisions.md) |

Module-specific details live in each `src/<module>/README.md`.

## Goals

- **The spec is the center.** Every module depends on the spec's model and
  contract, and nothing depends on a particular backend except the app that
  chooses it.
- **Backends are adapters.** The file system is the reference adapter. Jira, a
  GitHub-backed store or a database are further adapters behind the same
  contract.
- **Frontends share one core.** The CLI, the web app and a future TUI run the
  same logic; they differ only in presentation. Once the hub exists, they
  share project handling through it too.
- **Human and agent friendly.** Files stay hand-editable with minimal diffs.
  The CLI is scriptable (`--json`, no prompts without a TTY, stable exit
  codes).

## Modules

todo.md ships as **one package**, `@lemol/todo-md`, whose repository root is
the package. Each module is a directory under `src/` and a subpath export
([why](./tooling.md#why-one-package)).

Today:

```
                ┌───────── cli (`todo`) ─────────┐   ┌──── web ────┐
                │  composition root              │   │ composition │
                └──────┬────────────────────────┘   │ root        │
                       │                            └─────┬───────┘
                       ▼                                  │
                     core                                ▼
                       ▲                            hub ───────► fs ───► markdown
                       │                            ▲
                       └────────────────────────────┘
          (queries, ready/blocked,   (TodoStore on disk)   (pure parse +
           validation, guards)                              splice writer)
                       │                   │                   │
                       └──────────► spec ◄─┴───────────────────┘
                       (model, errors, TodoStore contract,
                        MemoryTodoStore, conformance suite)
```

The sources sit beside the hub, built at each composition root and passed in
(`git`, `jira` and `sqlite` are built):

```
cli ─┬─► hub ──► core ──► spec
web ─┤    │  └─► fs ──► markdown
tui ─┘    ▲      ▲
       git ──────┘    git: fs over a clone + commit/push
       jira ─► hub    jira: Jira REST behind a JSON mirror
       sqlite ─► hub  sqlite: one SQLite file behind an injected driver
```

| Module                          | Import path                    | May import                               | Responsibility                                                                  |
| ------------------------------- | ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------- |
| [`src/spec`](../../src/spec)         | `@lemol/todo-md/spec`          | `effect`                                 | Model schemas, errors, the `TodoStore` contract, reference in-memory store      |
|                                 | `@lemol/todo-md/spec/testing`  | spec, `bun:test`, `node:assert`          | Test helpers and the conformance suite, for tests only                          |
| [`src/markdown`](../../src/markdown) | `@lemol/todo-md/markdown`      | spec, `effect`, mdast/micromark, `yaml`  | Pure parse/serialize of `TODO.md` and task files; normalization; slugs          |
| [`src/core`](../../src/core)         | `@lemol/todo-md/core`          | spec, `effect`                           | Adapter-agnostic logic: queries, ready/blocked, validation, mutation guards     |
| [`src/fs`](../../src/fs)             | `@lemol/todo-md/fs`            | spec, markdown, `effect`                 | `TodoStore` over a list directory; discovery; safe writes                       |
| [`src/hub`](../../src/hub)           | `@lemol/todo-md/hub`           | spec, core, fs, `effect`, `yaml`         | Projects: registry, resolution, a `TodoService` per project; the `Source` interface and `fsSource` (sync, changes and cross-project queries: task 15) |
|                                 | `@lemol/todo-md/hub/testing`   | hub, spec                                | `memorySource`, for tests only                                                  |
| [`src/git`](../../src/git)           | `@lemol/todo-md/git`           | spec, fs, hub, `effect`                  | `gitSource`: a list in a git repository, cloned into `~/.todo-md` (task 19)      |
| [`src/jira`](../../src/jira)         | `@lemol/todo-md/jira`          | spec, hub, `effect`                      | `jiraSource`: Jira tickets behind a local mirror; mutations go to Jira first     |
| [`src/sqlite`](../../src/sqlite)     | `@lemol/todo-md/sqlite`        | spec, hub, `effect`                      | `sqliteSource`: a list in a SQLite file, behind an injected `SqliteDriver` ([design](../superpowers/specs/2026-10-19-sqlite-source-design.md)) |
| [`src/cli`](../../src/cli)           | `@lemol/todo-md/cli`           | spec, core, fs, hub, git, jira, sqlite, web, `effect`, `@effect/platform-bun`, `node:*`, `bun`, `bun:sqlite` | The `todo` binary        |
| [`src/web`](../../src/web)           | — (wired by the CLI's `web` command) | `spec`, `core`, `hub`, `git` (+ `effect`, Remix, Markdown renderers, `@lemol/ui`; `node:`/`bun` only in `server.ts`, `app/assets.ts`) | Local web UI over hub projects |

Planned rows are not enforced yet; each task that builds one adds its rule to
the boundaries test.

**Dependency rules** (enforced by
[`test/boundaries.test.ts`](../../test/boundaries.test.ts), which reads every
import in `src/` and checks it against the table above (`src/web` is
checked by `webViolations`, the web import graph, instead):

- Modules import each other with relative paths, never through the package
  name.
- `core` never imports an adapter.
- `markdown` does no I/O.
- Only apps (`cli`, `web`) choose and wire adapters, and only app composition
  roots touch Bun or Node APIs directly.
- Runtime code never imports `spec/testing` or `hub/testing`.
