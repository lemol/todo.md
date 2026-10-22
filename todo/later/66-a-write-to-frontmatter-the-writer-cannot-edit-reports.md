---
title: A write to frontmatter the writer cannot edit reports success and loses the change
tags: [bug, markdown, fs]
---
Found by the controller's post-land review of todo-md:65 (landed `318d1ca`). 65 made `frontmatterEdits` (`src/markdown/frontmatter.ts`) return no edits for frontmatter whose aliases do not resolve when it is not a block map, and the README documents that as "left unchanged". The store does not know: every write still reports success.

Evidence (scratch list at `318d1ca`, own `HOME` and `TODO_MD_HOME`; `later/1-bad.md` and `later/3-c.md` are `---\n{title: Bad, x: *a}\n---\nBody\n`):

- `todo edit 1 --assignee y` prints `Updated 01  Bad`, exit 0; the file is unchanged.
- `todo done 1` prints `Done 01  Bad`, exit 0; `done/01-bad.md` has no `completed_at` (spec §2.6: REQUIRED in done files) and no `group`. `todo reopen 1` then puts it at the end of the ungrouped tasks as `[01 - bad](./01-bad.md)`: the group is gone.
- `todo cancel 3 --reason "no longer needed"` prints `Cancelled 03  C`, exit 0; `done/03-c.md` has no `outcome` or `cancelled_reason`, so it reads back as completed and the reason is lost.

The same class predates 65 on the other fallback branch: frontmatter with a YAML syntax error is replaced whole. `later/2-good.md` = `---\ntitle: Bad\nx: [\n---\nBody\n`, then `todo edit 2 --assignee y` writes `---\nassignee: y\n---\nBody\n`: `title` and every other line are deleted (fallback since `03df9fa`).

#### What to build

1. A write that changes frontmatter the writer cannot edit key by key (any frontmatter `readFrontmatter` reports an `error` for, except where the edit can splice block-map keys as 65 does) fails instead of reporting success: the store's operation fails with an error naming the file and the `invalid-frontmatter` message, and leaves the file and `TODO.md` as they were. This covers `update`, `complete`, `cancel`, `reopen` and comment/promote writes that touch frontmatter. Recommended over silently dropping or wholly replacing; if the planner finds a reason to keep a fallback for some shape, say which and why in the plan.
2. Frontmatter that reads as `not a mapping` without other errors (`- a\n- b`, `hello`) is the planner's call: today it is replaced whole (65's F2 kept that). State the choice.
3. Spec §2.10 (or §2.6) says what a write does to frontmatter that is `invalid-frontmatter`; the `src/markdown/README.md` Frontmatter bullet follows.
4. The CLI prints the failure and exits non-zero (no stack trace).

#### Tests first

- `todo edit`, `todo done` and `todo cancel` on a task whose frontmatter is `{title: Bad, x: *a}` exit non-zero, name the file, and leave the task file and `TODO.md` byte-identical.
- The same for frontmatter `title: Bad\nx: [`: `title` is not deleted.
- A block map with an unresolved alias (`title: T\nx: *a`) still takes `edit --assignee y` as a splice (65's behaviour stays).
- The conformance suite or an fs store test pins that a failed write leaves no partial move (`done/` gets no file).

#### Done when

No store write reports success while dropping the fields it was asked to write, and no edit deletes frontmatter lines it was not asked to change.

#### Out of scope

The hub registry's YAML (todo-md:67).
