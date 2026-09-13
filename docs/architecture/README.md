# Architecture

How the todo.md modules fit together and why they are split the way they
are. For what a task *is* and how the files look, see
[spec.md](../spec.md).

| Topic | File |
| --- | --- |
| The `TodoStore` contract, capabilities, conformance, writing an adapter | [contract.md](./contract.md) |
| `markdown` and `fs`: parsing, splicing writes, the write path, locking | [storage.md](./storage.md) |
| `hub`: projects, the registry, sync, changes, cross-project queries *(planned)* | [hub.md](./hub.md) |
| Sources: fs, git and jira behind the hub *(planned)* | [sources.md](./sources.md) |
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
                ┌───────── cli (`todo`) ─────────┐        web
                │  composition root: wires the    │
                │  fs adapter into core           │
                └──────┬───────────────────┬──────┘
                       ▼                   ▼
                     core                  fs ────────► markdown
          (queries, ready/blocked,   (TodoStore on disk)   (pure parse +
           validation, guards)                              splice writer)
                       │                   │                   │
                       └──────────► spec ◄─┴───────────────────┘
                       (model, errors, TodoStore contract,
                        MemoryTodoStore, conformance suite)
```

Planned ([hub design](../superpowers/specs/2026-09-13-hub-design.md)):

```
cli ─┬─► hub ──► core ──► spec
web ─┤    │  └─► fs ──► markdown
tui ─┘    ▲      ▲
       git ──────┘    git: fs over a clone + commit/push
       jira ─► hub    jira: Jira REST behind a JSON mirror
```

| Module                          | Import path                    | May import                               | Responsibility                                                                  |
| ------------------------------- | ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------- |
| [`src/spec`](../../src/spec)         | `@lemol/todo-md/spec`          | `effect`                                 | Model schemas, errors, the `TodoStore` contract, reference in-memory store      |
|                                 | `@lemol/todo-md/spec/testing`  | spec, `bun:test`, `node:assert`          | Test helpers and the conformance suite, for tests only                          |
| [`src/markdown`](../../src/markdown) | `@lemol/todo-md/markdown`      | spec, `effect`, mdast/micromark, `yaml`  | Pure parse/serialize of `TODO.md` and task files; normalization; slugs          |
| [`src/core`](../../src/core)         | `@lemol/todo-md/core`          | spec, `effect`                           | Adapter-agnostic logic: queries, ready/blocked, validation, mutation guards     |
| [`src/fs`](../../src/fs)             | `@lemol/todo-md/fs`            | spec, markdown, `effect`                 | `TodoStore` over a list directory; discovery; safe writes                       |
| `src/hub` *(planned)*           | `@lemol/todo-md/hub`           | spec, core, fs, `effect`, `yaml`         | Projects, registry, sync, changes, cross-project queries; the `Source` interface and `fsSource` |
| `src/git` *(planned)*           | `@lemol/todo-md/git`           | spec, fs, hub, `effect`                  | `gitSource`: a list in a git repository, cloned into `~/.todo-md`               |
| `src/jira` *(planned)*          | `@lemol/todo-md/jira`          | spec, hub, `effect`                      | `jiraSource`: Jira tickets behind a local mirror                                |
| [`src/cli`](../../src/cli)           | `@lemol/todo-md/cli`           | spec, core, fs, `effect`, `@effect/platform-bun`, `node:*`, `bun` | The `todo` binary                                      |
| [`apps/web`](../../apps/web)         | `@lemol/todo-md-web`           | public todo-md subpaths, `effect`, Remix and renderer packages; server entry also Bun/Node | Private local web UI over one list |

Planned rows are not enforced yet; each task that builds one adds its rule to
the boundaries test.

**Dependency rules** (enforced by
[`test/boundaries.test.ts`](../../test/boundaries.test.ts), which reads every
import in `src/` and `apps/web` and checks it against the table above):

- Modules import each other with relative paths, never through the package
  name.
- `core` never imports an adapter.
- `markdown` does no I/O.
- Only apps (`cli`, `web`) choose and wire adapters, and only app composition
  roots touch Bun or Node APIs directly.
- Runtime code never imports `spec/testing`.
