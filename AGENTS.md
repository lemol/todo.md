# AGENTS.md

todo.md is a standard for Markdown task lists, with a reference file-system
implementation and a `todo` CLI. It ships as one Bun + Effect 4 package,
`@lemol/todo-md`, with a subpath export per module.

## Read first

- [docs/spec.md](docs/spec.md) is the source of truth for behavior. If code
  and spec disagree, fix one of them deliberately. Never let them drift
  silently.
- [docs/architecture/](docs/architecture/README.md) covers module boundaries and
  the reasons for them.
- Each `src/<module>/README.md` covers that module's contents and limits.

## Backlog

This repository's own tasks live in [`todo/TODO.md`](todo/TODO.md), a todo.md
list. Use the CLI from source to work with it: `bun src/cli/bin.ts next`,
`bun src/cli/bin.ts done <id>`, `bun src/cli/bin.ts --help`.

## Layout

```
docs/          spec and architecture
src/
  spec/        model, errors, TodoStore contract (+ testing: conformance suite)
  markdown/    pure parse + minimal-diff writer (no I/O)
  core/        adapter-agnostic logic (never imports an adapter)
  fs/          TodoStore over a list directory
  cli/         `todo` binary: the composition root
src/web/        local Remix web UI over one list (see `todo web`)
test/          bun:test suites, mirroring src/, plus boundaries.test.ts
               and sandbox.ts (preloaded; see the isolation rule below)
```

## Commands

```sh
bun install
bun run check         # lint + typecheck + tests: the gate for every change
bun test              # tests only
bun run fix           # apply Biome fixes
bun src/cli/bin.ts    # run the todo CLI from source
bun src/cli/bin.ts web --dir todo  # run the local web app
```

## Rules

- **Module graph.** `test/boundaries.test.ts` enforces it. Modules import
  each other through relative paths, never through `@lemol/todo-md/...`. If
  a new import is needed, update the architecture doc and the test's rules
  together.
- **Minimal diffs.** Writers must produce minimal diffs (spec §2.10): splice
  text, never re-serialize a whole Markdown file.
- **Conformance.** Every `TodoStore` implementation must pass
  `runConformance`.
- **Tests** use `bun:test`, plus the `effectTest` helper from
  `src/spec/testing.ts`.
- **Test isolation.** This repository is itself a todo.md list, and the
  machine's hub registry names it, so a test that reads an ambient
  `process.cwd()`, `$HOME` or `$TODO_MD_HOME` can edit real work and still
  pass. Give every test — and every process it spawns — a home and a working
  directory of its own. `test/sandbox.ts` (preloaded via `bunfig.toml`) hands
  the run an empty hub and fails any test that writes to the real list or
  registry.
- **Effect version.** `effect` is an exact peer dependency matching the
  other lemol repositories (framework, org, nzila, mionso). Change it only
  together with them, and keep `@effect/platform-bun` and
  `@effect/platform-node-shared` (pinned and overridden) on the same version.
- **This repo stands alone.** It must not depend on other lemol
  repositories. `lemol-workspace` composes it as `repos/todo-md`.
- **CLI help.** Every command needs a description, a description for each
  flag and argument, and examples; `test/cli/help.test.ts` checks every
  command.
- **Docs.** Keep them short and local. Module-specific details go in that
  module's README, not here.

## Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.
