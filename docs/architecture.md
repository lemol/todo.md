# Architecture

This document describes how the todo.md modules fit together and why they are
split the way they are. For what a task *is* and how the files look, see
[spec.md](./spec.md).

## Goals

- **The spec is the center.** Every module depends on the spec's model and
  contract, and nothing depends on a particular backend except the app that
  chooses it.
- **Backends are adapters.** The file system is the reference adapter. Jira, a
  GitHub-backed store or a database are further adapters behind the same
  contract.
- **Frontends share one core.** The CLI today and a web app later run the same
  logic; they differ only in presentation and in the adapter they wire in.
- **Human and agent friendly.** Files stay hand-editable with minimal diffs.
  The CLI is scriptable (`--json`, no prompts without a TTY, stable exit
  codes).

## Modules

todo.md ships as **one package**, `@lemol/todo-md`, whose repository root is
the package. Each module is a directory under `src/` and a subpath export:

```
                ┌───────── cli (`todo`) ─────────┐        web (later)
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

| Module                          | Import path                    | May import                               | Responsibility                                                                  |
| ------------------------------- | ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------- |
| [`src/spec`](../src/spec)         | `@lemol/todo-md/spec`          | `effect`                                 | Model schemas, errors, the `TodoStore` contract, reference in-memory store      |
|                                 | `@lemol/todo-md/spec/testing`  | spec, `bun:test`, `node:assert`          | Test helpers and the conformance suite, for tests only                          |
| [`src/markdown`](../src/markdown) | `@lemol/todo-md/markdown`      | spec, `effect`, mdast/micromark, `yaml`  | Pure parse/serialize of `TODO.md` and task files; normalization; slugs          |
| [`src/core`](../src/core)         | `@lemol/todo-md/core`          | spec, `effect`                           | Adapter-agnostic logic: queries, ready/blocked, validation, mutation guards     |
| [`src/fs`](../src/fs)             | `@lemol/todo-md/fs`            | spec, markdown, `effect`                 | `TodoStore` over a list directory; discovery; safe writes                       |
| [`src/cli`](../src/cli)           | `@lemol/todo-md/cli`           | spec, core, fs, `effect`, `@effect/platform-bun`, `node:*`, `bun` | The `todo` binary                                      |

**Dependency rules** (enforced by
[`test/boundaries.test.ts`](../test/boundaries.test.ts), which reads every
import in `src/` and checks it against the table above):

- Modules import each other with relative paths, never through the package
  name.
- `core` never imports an adapter.
- `markdown` does no I/O.
- Only apps (`cli`, later `web`) choose and wire adapters, and only `cli`
  touches Bun or Node APIs directly.
- Runtime code never imports `spec/testing`.

### Why one package

todo.md is consumed the way the other lemol repositories are: as a git
dependency pinned to a tag, which a composition root such as
`lemol-workspace` overrides with a local checkout:

```jsonc
// consumer
"@lemol/todo-md": "git+ssh://git@github.com/lemol/todo.md.git#todo-md@0.1.0"
// composition root
"overrides": { "@lemol/todo-md": "file:./repos/todo-md" }
```

Git dependencies install only the repository's root package. We checked the
alternative: an umbrella root package that re-exports inner workspace
packages fails at runtime, because the inner packages' imports of each other
(`@lemol/todo-md-spec`) and their own dependencies are never installed. One
package with subpath exports works, and the boundaries test keeps the modules
honest the way separate manifests would.

`effect` is a **peer dependency pinned to the exact version the other lemol
repositories use**. Two copies of `effect` in one process break schema and
error class identity and Effect's runtime internals, so consumers, framework
and todo.md must share a single copy.

## The contract: `TodoStore`

`TodoStore` is an Effect service (`Context.Service`) defined in `spec`. Its
methods are the Part 1 operations of the spec, one to one:

```ts
export class TodoStore extends Context.Service<TodoStore, {
  readonly capabilities: Capabilities
  load(): Effect<TodoList, StoreError>
  get(id: TaskId): Effect<Task, TaskNotFound | StoreError>
  listDone(): Effect<ReadonlyArray<Task>, StoreError>
  add(input: TaskInput, placement?: Placement): Effect<Task, ValidationError | TaskNotFound | Unsupported | StoreError>
  update(id: TaskId, patch: TaskPatch): Effect<Task, TaskNotFound | ValidationError | StoreError>
  move(id: TaskId, placement: Placement): Effect<Task, TaskNotFound | InvalidTransition | ValidationError | Unsupported | StoreError>
  complete(id: TaskId): Effect<Task, TaskNotFound | InvalidTransition | StoreError>
  reopen(id: TaskId): Effect<Task, TaskNotFound | InvalidTransition | StoreError>
  remove(id: TaskId): Effect<void, TaskNotFound | StoreError>
  renameGroup(from: string, to: string): Effect<void, GroupNotFound | ValidationError | Unsupported | StoreError>
  comment(id: TaskId, input: CommentInput): Effect<Comment, TaskNotFound | ValidationError | Unsupported | StoreError>
  diagnostics(): Effect<ReadonlyArray<Diagnostic>, StoreError>
}>()("@lemol/todo-md/spec/TodoStore") {}
```

(Abridged: `Effect<…>` stands for `Effect.Effect<…>`. The source of truth is
[`src/spec/TodoStore.ts`](../src/spec/TodoStore.ts).)

- **Operations are fine-grained.** A Jira adapter maps each one to an API
  call, and a file adapter maps each one to a read-modify-write.
- **`diagnostics()`** returns format-level issues found while reading, such as
  broken links. An adapter with nothing to report returns an empty array.
- **Model-level checks are shared, not duplicated per adapter.** Stores must
  reject self-dependencies and cycles on `add`/`update` (spec §1.6), and all
  of them use `ensureAcyclic` from `spec` to do it. Reporting existing
  problems (`check`: unknown dependencies, duplicate IDs, cycles introduced by
  hand edits) lives in `core`.

### Reference implementation and conformance

- **`MemoryTodoStore`** (in `spec`) is the simplest executable statement of the
  operation semantics. `core`'s tests run against it.
- **The conformance suite** (in `spec`) is a list of runner-agnostic cases,
  each an Effect that runs against a fresh store and asserts with
  `node:assert`. `runConformance(name, layer)` registers them with
  `bun:test`. Every adapter's test suite calls it, and `MemoryTodoStore`
  passes it too. The spec's operation semantics are therefore tested, not
  only written down.

## core

`TodoService` is a layer that requires a `TodoStore` and provides:

- **Queries:** filter by tag, assignee, group and status; `next()` returns the
  ready tasks in priority order (spec §1.3); `show(id)` returns a task with
  its dependency status.
- **`check()`:** model validation (`duplicate-id`, `unknown-dependency`,
  `self-dependency`, `dependency-cycle`) merged with the store's
  `diagnostics()`.
- **Guarded mutations:**
  - `add` and `update` reject a `dependsOn` that creates a cycle.
  - `remove` refuses when open tasks depend on the task, unless forced.
  - Operations the store's capabilities don't include fail early with
    `Unsupported`.

`core` knows nothing about Markdown, files or the CLI. It is what a web app
imports too.

## markdown

`markdown` is a pure library: strings in, model and strings out.

- **Parsing uses `mdast-util-from-markdown`** with the GFM task-list and
  frontmatter extensions. The AST gives headings, lists, links and code
  fences, following CommonMark. Every node carries source offsets.
- **The parse result is the model plus a source map.** The map records, for
  each section, item, metadata line and comment, the offsets where it lives
  in the original text.
- **Writing splices text; it never re-serializes.** Edits such as
  `insertTask`, `removeTask`, `setItemLine`, `setMetadataLine` and
  `prependComment` replace only the offsets involved, and new lines come from
  small canonical templates. This is how the spec's minimal-diff rule
  (§2.10) holds. `remark-stringify` is deliberately not used, because it
  rewrites the whole document.
- **Frontmatter goes through `yaml`'s `Document` API**, which keeps comments,
  key order and unknown keys when a field is edited.
- **It also owns:**
  - normalization, as a pure function from a snapshot to a list of edits;
  - slugs and ID formatting;
  - the metadata-line grammar;
  - the format diagnostics.
- **It doesn't depend on Bun or Node**, so a browser (the web app) or a
  GitHub-backed adapter can reuse it.
- **Tests are golden fixtures:** `input.md` + operation → `expected.md`.

## fs

`FsTodoStore.layer({ root })` implements `TodoStore` for a list directory
using Effect's `FileSystem` and `Path` services. `findListRoot(cwd)` handles
discovery: starting at `cwd` and walking up, the first directory where
`todo/TODO.md` or `TODO.md` exists wins, with `todo/TODO.md` preferred at
each level.

### The write path

Every mutating operation runs the same pipeline:

```
acquire lock
  → read TODO.md (+ the task files it needs)
  → parse (markdown)
  → normalize (spec §2.11)
  → apply the operation's edits
  → write files in crash-safe order
release lock
```

- **No cache.** Every operation re-reads the files, so hand edits made
  between commands are always seen. A long-running host (the web app) watches
  files instead of caching them.
- **Atomic writes.** Each file is written to a temporary file in the same
  directory, then renamed over the original.
- **Advisory lock.** `<root>/.todo.lock` is created exclusively for the
  duration of a mutation, so parallel processes, typically several agents,
  cannot lose each other's updates. A lock older than a timeout is treated as
  stale and taken over. Reads don't lock.
- **Crash-safe ordering.** Multi-file operations order their steps so that an
  interruption leaves a state that normalization can repair or a diagnostic
  reports. For `complete` and `reopen` the done file is the commit point
  (spec §2.10): an interrupted completion is finished, and an interrupted
  reopen is rolled back.
- **Normalization** is also exposed on its own as `normalize()`. It is
  specific to the file format, so it is not part of the contract; the CLI's
  `fmt` command calls it directly.

## cli

The CLI is built with `effect/unstable/cli` (`Command`, `Flag`, `Argument`)
and runs on `BunRuntime`. It is the composition root:

```ts
todo.pipe(
  Command.run({ version }),
  Effect.provide(TodoService.layer),
  Effect.provide(FsTodoStore.layer({ root })),  // root from --dir or findListRoot
  Effect.provide(BunServices.layer),
  BunRuntime.runMain
)
```

- **Commands:** `init`, `list`/`ls` (the default), `show`, `add`, `edit`,
  `done`, `reopen`, `mv`, `rm`, `comment`, `next`, `check`, `fmt`. The full
  surface is in the [cli README](../src/cli/README.md).
- **Output:** human-readable by default; `--json` on every command prints one
  JSON document to stdout, and diagnostics go to stderr.
- **Non-interactive:** the CLI never prompts when stdin is not a TTY.
- **Exit codes:** `0` success, `1` domain error (not found, validation,
  `check` found errors), `2` usage error.
- **Comment author:** `--author`, then `$TODO_MD_AUTHOR`, then the OS user
  name.

## Testing

- **Runner:** `bun test` everywhere. `@effect/vitest` is not used because it
  depends on vitest internals.
- **Effect helper:** `@lemol/todo-md/spec/testing` exports
  `effectTest(name, effect, layer?)`, which runs an Effect in a `bun:test`
  test with a scope and Effect's `TestClock`/`TestConsole` (`effect/testing`).
  This entry point is never imported by runtime code.
- **Boundaries:** `test/boundaries.test.ts` enforces the module graph.
- **Layout:** tests live in `test/<module>/`, mirroring `src/`.

| Module     | Strategy                                                                   |
| ---------- | -------------------------------------------------------------------------- |
| `spec`     | `MemoryTodoStore` passes the conformance suite.                            |
| `markdown` | Golden fixtures for parsing, every edit and normalization; minimal diffs asserted. |
| `core`     | Unit tests against `MemoryTodoStore`.                                      |
| `fs`       | Conformance suite against temporary directories, plus crash/lock/hand-edit scenarios. |
| `cli`      | End-to-end tests: run commands with `--json` against temporary directories. |

## Tooling

- **Bun 1.4** with a single `package.json` at the repository root.
- **Effect 4 RC.** `effect` is a pinned peer dependency (plus the same
  version as a dev dependency), and `@effect/platform-bun` uses the same
  version. Upgrade both together with the other lemol repositories.
- **TypeScript**, strict, with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`.
- **Biome** for linting and formatting.
- **One gate for CI and `lemol-workspace`:** `bun run check` runs lint,
  typecheck and tests.
- **No build step.** Subpath exports point at TypeScript sources, which Bun
  runs directly, the same as `@lemol/framework`.
- **Releases** are git tags named `todo-md@<version>`. A standalone binary via
  `bun build --compile` can come later.

## Extension points

- **A new adapter** implements `TodoStore` from `@lemol/todo-md/spec`,
  declares its capabilities, and runs `runConformance` from
  `@lemol/todo-md/spec/testing`. It can be a new module here (for example
  `src/jira`) or live in another repository. Apps choose it at the
  composition root.
- **The web app** imports `@lemol/todo-md/core` and an adapter, the same as
  the CLI. In the browser, a GitHub-backed or File System Access adapter can
  reuse `@lemol/todo-md/markdown` unchanged. If it lives in this repository,
  it goes in `apps/web` as a private workspace member, outside the published
  package.

## Decision log

| Decision                                   | Why                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| One spec with model + format parts         | Adapters like Jira need the abstract model; the file format stays the concrete, canonical face. |
| Stable sequential IDs, opaque in the model | Short to type and stable for `depends_on`; Jira keys fit the same slot.              |
| Inline tasks with a metadata line          | Quick one-liners stay in `TODO.md`; the title line stays free of metadata syntax.    |
| Completed tasks become files in `done/`    | History stays browsable; `TODO.md` shows only open work.                             |
| Groups map to directories by convention    | The folder layout mirrors `TODO.md`; parsers stay lenient about hand-placed files.   |
| Comments as `###` headings in task files   | Comments are free-form Markdown; headings avoid the indentation traps of list items. |
| mdast for reading, splicing for writing    | A well-tested parser, plus minimal diffs that re-serialization can't give.           |
| Separate pure `markdown` module            | Reusable in the browser and by other file-based adapters.                            |
| One package with subpath exports           | Git dependencies install only the root package; an umbrella over workspace packages fails at runtime. |
| Boundaries enforced by a test              | Keeps the module graph as strict as separate package manifests would.                |
| `effect` as an exact peer dependency       | One shared copy of `effect` across all lemol repositories.                           |
| `bun test` instead of vitest               | Zero config; the helper we lose is about 20 lines.                                   |
| Fine-grained contract, no cache            | Maps to remote APIs; always sees hand edits.                                         |
