# AGENTS.md

todo.md is a standard for Markdown task lists, with a reference file-system
implementation and a `todo` CLI. It is a Bun + Effect 4 monorepo.

## Read first

- [docs/spec.md](docs/spec.md) is the source of truth for behavior. If code
  and spec disagree, fix one of them deliberately. Never let them drift
  silently.
- [docs/architecture.md](docs/architecture.md) covers package boundaries and
  the reasons for them.
- Each `packages/*/README.md` covers that package's contents and limits.

## Layout

```
docs/          spec and architecture
packages/
  spec/        model, errors, TodoStore contract, conformance suite
  markdown/    pure parse + minimal-diff writer (no I/O)
  core/        adapter-agnostic logic (never imports an adapter)
  fs/          TodoStore over a list directory
  cli/         `todo` binary: the composition root
```

## Commands

```sh
bun install
bun test              # all tests (bun:test)
bun run typecheck
bun run lint          # `bun run fix` to auto-fix
```

## Rules

- Respect the dependency direction in the architecture doc. `markdown` does
  no I/O, and `core` knows no adapter.
- Writers must produce minimal diffs (spec §2.10): splice text, never
  re-serialize a whole Markdown file.
- Every `TodoStore` implementation must pass `runConformance`.
- Tests use `bun:test`, plus the `effectTest` helper from
  `@lemol/todo-md-spec/testing`.
- Keep docs short and local. Package-specific details go in that package's
  README, not here.
- Pin Effect packages through the root `catalog`, never per package.

## Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.
