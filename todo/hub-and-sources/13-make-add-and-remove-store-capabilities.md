---
title: Make add and remove store capabilities
tags: [spec]
---
## Goal

Let a store leave out `add` and `remove`, so the Jira source (task 06) can
mirror tickets without creating or deleting issues. Design:
[hub design §5](../../docs/superpowers/specs/2026-09-13-hub-design.md#5-spec-change-add-and-remove-capabilities).

## Scope

In:

- Spec §1.5: two new capabilities, `add` and `remove`.
- `Capabilities`, `allCapabilities`, `core`'s guard, the conformance suite.
- The CLI and web app honoring them.

Out: any Jira code; changing other capabilities.

## Design

- **Spec (`docs/spec.md` §1.5).** Add rows:
  - `add`: when absent, `add` fails with `Unsupported`.
  - `remove`: when absent, `remove` fails with `Unsupported`.

  The always-required sentence becomes: "`load`, `get`, `listDone`,
  `update`, `complete` and `reopen` are always required." Also update the
  §1.4 error column for `add` and `remove` (add `Unsupported`) and the
  `TodoStore` signature of `remove` in `src/spec/TodoStore.ts`
  (`TaskNotFound | Unsupported | StoreError`).
- **`src/spec/TodoStore.ts`.** `Capabilities` gains `add` and `remove`
  booleans; `allCapabilities` sets both to `true`. `MemoryTodoStore` and
  `FsTodoStore` declare both.
- **`core`.** The capability guard (`src/core/TodoService.ts`, around the
  existing `store.capabilities[capability]` check) fails `add` without `add`
  and `remove` without `remove`, before calling the store.
  `HasDependents` checking for `remove` happens after the capability check.
- **Conformance** (`src/spec/testing/conformance/`). Cases already declare
  `requires`. Mark cases that exercise `add` or `remove` themselves with
  those capabilities. Most other cases use `add` only to set up state:
  - `runConformance(name, layer, options?)` and the case runner accept
    `options.seed`: `(tasks: ReadonlyArray<SeedTask>) => Effect<ReadonlyArray<Task>, unknown, TodoStore>`,
    which puts open (and, where a case needs them, done) tasks into a fresh
    store and returns them with their assigned IDs.
  - Add a setup helper (for example `given(...)` in `case.ts`) that uses
    `seed` when provided and otherwise `store.add` (+ `complete` for done
    tasks). Convert cases to it.
  - A case that needs setup but has neither `add` nor `seed` is skipped,
    with the reason in its name.
  - Export `SeedTask` from `@lemol/todo-md/spec/testing`.
- **CLI.** `todo add` and `todo rm` already print `Unsupported` via core;
  check the message reads well ("this list does not support add").
- **Web.** Hide the add form when `capabilities.add` is false (remove isn't
  in the web app yet; task 10 must honor `remove`).

## Files

- `docs/spec.md`, `src/spec/TodoStore.ts`, `src/spec/MemoryTodoStore.ts`
- `src/fs/FsTodoStore.ts`
- `src/core/TodoService.ts`, `src/core/README.md`
- `src/spec/testing/conformance/*.ts`, `src/spec/testing.ts`,
  `src/spec/README.md`
- `apps/web/app/ui/board.tsx` (add form), web tests
- `docs/architecture/contract.md` (drop "Planned (task 13)")

## Tests

- `core`: a wrapped `MemoryTodoStore` without `add`/`remove` fails with
  `Unsupported` and the store is never called (extend the existing
  "no optional capabilities" test).
- Conformance: a test store without `add` but with a `seed` runs every case
  that doesn't require `add`; without `seed` those cases are skipped.
  `MemoryTodoStore` and `FsTodoStore` still pass everything.
- Web: the board without `add` has no add form.

## Done when

- Spec, code and docs agree on the new capabilities.
- `bun run check` passes.
