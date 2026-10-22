---
title: An unresolved YAML alias in frontmatter crashes every read
tags: [bug, markdown]
---
Found by the controller's post-land review of todo-md:64 (landed `d8f93e1`), while fuzzing the frontmatter reader and writer. It predates 64: `doc.toJS()` has read frontmatter since `03df9fa`.

**Cause.** `readFrontmatter` (`src/markdown/frontmatter.ts`) checks `doc.errors` and then calls `doc.toJS()`. The `yaml` library parses an alias to a missing anchor (`x: *a`) without an error, and throws from `toJS()` instead (`node_modules/yaml/dist/nodes/Alias.js`: "Unresolved alias (the anchor must be set before the alias)"; the same method throws "Excessive alias count indicates a resource exhaustion attack"). `parseTaskFile` says "Never fails", and spec §2.6 says invalid frontmatter is an `invalid-frontmatter` diagnostic, but the exception escapes it.

Evidence (scratch list at `d8f93e1`: `TODO.md` with `[1 - Bad](./later/1-bad.md)` and `[2 - Good](./later/2-good.md)`; `later/1-bad.md` is `---\ntitle: Bad\nx: *a\n---\nBody\n`; own `HOME` and `TODO_MD_HOME`):

- `todo list`, `todo check` and `todo show 2` each exit 1 with `ReferenceError: Unresolved alias (the anchor must be set before the alias): a`, thrown from `readFrontmatter` via `parseTaskFile` (`src/fs/parsing.ts`) and `src/fs/snapshot.ts`. One bad file makes the whole list unreadable, including `check`, the command meant to report it.
- `parseTaskFile`, `updateTaskFile` and `parseTodoFile` throw the same error on frontmatter `x: *a`.

#### What to build

1. `readFrontmatter` turns any throw from `toJS()` into its `error`, so callers report `invalid-frontmatter` (the message's first line, as for parse errors).
2. `frontmatterEdits` must not throw on the same text: treat it as YAML that does not parse (the existing whole-frontmatter fallback), or leave the frontmatter as it is. Say which in the README's Frontmatter bullet.
3. Bump `taskFileParserVersion` only if a parse the cache can hold changes. A throw was never cached, so it likely does not.

#### Tests first

- `parseTaskFile` on `"---\ntitle: T\nx: *a\n---\nBody\n"` does not throw and reports one `invalid-frontmatter` diagnostic.
- `parseTodoFile` on a `TODO.md` whose frontmatter is `x: *a` does not throw and reports `invalid-frontmatter`.
- `updateTaskFile` on the task file above with `{ assignee: "y" }` does not throw.
- An alias to an anchor that exists (`a: &x 1\nb: *x`) still reads `b` as `1`.

#### Done when

No frontmatter text makes `parseTaskFile` or `parseTodoFile` throw, and `todo check` on the list above reports the bad file instead of exiting with a stack trace.

#### Out of scope

The hub registry's own YAML (`src/hub/registry.ts`), which reads with `doc.get`, not `toJS()`.
