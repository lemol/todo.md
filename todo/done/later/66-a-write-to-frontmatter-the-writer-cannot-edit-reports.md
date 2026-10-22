---
title: A write to frontmatter the writer cannot edit reports success and loses the change
tags: [bug, markdown, fs]
group: Later
completed_at: 2026-10-22T04:48:38Z
outcome: completed
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

## Comments

### @nzila at 2026-10-22 04:48:38 +00:00

Done: todo-md:66 implemented in two commits on nzila/01M5GY12N5NBDM94VGGKMW955K.

What was built (followed plan.md task order):
- d4de5c7 `fix(markdown,fs): fail writes to frontmatter the writer cannot edit`
  - `src/markdown/frontmatter.ts`: `frontmatterEdits` now returns `Result<FrontmatterEdit[], string>`; fails with the reader's message whenever `readFrontmatter` reports an error and the YAML is not a block map whose only fault is unresolved aliases. 65's block-map splice still succeeds; error-free flow maps and `~` still whole-replace.
  - `src/markdown/taskFile.ts`: `updateTaskFile` returns `Result<string, string>`; fails only when `fields` is non-empty and the file has frontmatter (description-only edits proceed).
  - `src/fs/writing.ts`: new `editTaskFile(path, source, changes)` mapping failure to `StoreError("cannot edit <path>: invalid-frontmatter: <message>")`; used in `completeEntry`/`cancelEntry` (path `entry.item.path`, narrowed on the `source !== undefined && item.path !== undefined` pair). Edit computed before any write, so nothing moves to done/.
  - `src/fs/FsTodoStore.ts`: all 5 `updateTaskFile` call sites now go through `yield* editTaskFile` (`done.path` for done-file update and reopen, `item.path` for open-task update).
  - Tests: converted `test/markdown/frontmatter.test.ts` / `taskFile.test.ts` to `Result` (`edits`/`edit` helpers), replaced the two obsolete cases, added the refusal cases; new `test/fs/invalidFrontmatter.test.ts` (10 cases: update/complete/cancel/reopen fail byte-identical, description+comment proceed, block-map alias splices).
- eb3c46e `docs(spec): a write to frontmatter the writer cannot edit fails`
  - New `test/cli/frontmatter.test.ts` (edit/done/cancel exit 1 naming the file, nothing changes; block-map alias splices).
  - Spec §2.10 "Frontmatter a writer cannot edit" bullet; `src/markdown/README.md` Frontmatter bullet + `updateTaskFile` returns-a-`Result` note; `docs/architecture/storage.md` append.

Decisions/deviations from plan (code won):
- Effect 4 `Result` stores payloads as `.success`/`.failure`, not `.value` (checked `node_modules/.bun/effect@4.0.0/.../src/Result.ts:97-161`); used `edits.success`.
- `if (Result.isFailure(edits)) return edits` does not typecheck (`Failure<FrontmatterEdit[], string>` vs `Result<string,string>`); return `Result.fail(edits.failure)`.
- The fs test's mixed write arrays needed `as Array<Effect.Effect<unknown, InvalidTransition | StoreError | TaskNotFound | ValidationError>>` plus type imports to satisfy `failsWith` under `exactOptionalPropertyTypes`.
- No CLI code change needed, as planned: `StoreError` already prints `error: …` with exit 1 (covered by new CLI test).

Verification (each command run to completion, reported in order):
- `bun test test/markdown/frontmatter.test.ts test/markdown/taskFile.test.ts test/markdown/index.test.ts test/fs/invalidFrontmatter.test.ts test/fs/writing.test.ts test/fs/handEdits.test.ts test/fs/conformance.test.ts` → 222 pass, 0 fail.
- `bun test test/cli/frontmatter.test.ts test/cli/errors.test.ts test/cli/tasks.test.ts test/cli/help.test.ts` → 66 pass, 0 fail.
- `bun test test/boundaries.test.ts` → 13 pass, 0 fail (module graph untouched).
- `bun run lint` → clean (after `bun run fix` for formatting); `bun run typecheck` → clean.
- Known-bad: temporarily reverted only the `completeEntry` swap to old silent behavior with valid syntax → `test/fs/invalidFrontmatter.test.ts` 6 pass / 4 fail (all four "fails update, complete and cancel" cases); restored file byte-identical (`diff` clean) → 10 pass, 0 fail.
- Failures seen before fixing (all fixed, none hidden): my own import-merge typo in FsTodoStore, `.value` runtime TypeError, one missed multiline `frontmatterEdits(` assertion, 2 typecheck errors, 4 files needing `bun run fix`.
- Value search: `grep -rn "updateTaskFile(|frontmatterEdits(" src test` → src: `frontmatter.ts` (def), `taskFile.ts` (def + one internal use), `writing.ts` (import + one use); `FsTodoStore.ts` no longer references it. test: only the two converted markdown test files plus the new assertions — no other test pins the old string-return behavior.
- Full `bun run check` deliberately not run: the brief assigns the whole suite to the `check` stage. Worktree is clean (`git status` empty) at eb3c46e.

Review: approved (4/5)
Approved. I read the whole diff f9c97b4..eb3c46e (11 files), not just the summary.

Comments: the brief has no "Pre-start task comments", and todo/later/66-*.md (35 lines, headings only at lines 15/22/29/33: What to build, Tests first, Done when, Out of scope) has no Comments section. That makes 0 comments and no authors.

What to build:
1. Done. `frontmatterEdits` returns `Result.fail(error)` when `error !== undefined && !(unresolved && isMap(map) && !map.flow)` (src/markdown/frontmatter.ts). `updateTaskFile` passes that failure on. `editTaskFile` in src/fs/writing.ts maps it to `StoreError("cannot edit <path>: invalid-frontmatter: <msg>")`. All 5 call sites go through it: update on a done file, update on an open file, complete, cancel and reopen (grep: FsTodoStore.ts:277/297/412, writing.ts:97/143). There are no other callers (grep `updateTaskFile|frontmatterEdits|editTaskFile` in src). Comment uses `prependComment` and promote uses `formatTaskFile`; neither edits frontmatter. Each edit runs before any `files.write`, `writeTodo` or `remove`, so a failure leaves nothing half-done.
2. Done. The plan chose to make not-a-mapping frontmatter fail, with a reason. It is pinned by the shapes "a sequence" and "a scalar" in test/fs/invalidFrontmatter.test.ts and by "refuses frontmatter it cannot edit key by key".
3. Done. Spec §2.10 has a new bullet, "Frontmatter a writer cannot edit". The src/markdown/README.md Frontmatter bullet and storage.md were updated to match.
4. Done with no code change: an existing StoreError prints `error: …` and exits 1. Pinned by test/cli/frontmatter.test.ts "edit, done and cancel fail, name the file and change nothing", which expects the exact stderr, code 1 and empty stdout.

Tests-first and Done-when cases:
- edit/done/cancel on `{title: Bad, x: *a}` exit non-zero, name the file, and leave the task file and TODO.md byte-identical: pinned by test/cli/frontmatter.test.ts (describe.each row 1), which compares each file and the whole tree.
- The same for `title: Bad\nx: [`, with title kept: pinned by row 2 of the same describe.each, which also checks the file is byte-identical.
- A block map with an unresolved alias still splices: pinned by test/cli "edit still splices a block map whose alias does not resolve" and test/fs "a block map with an unresolved alias still takes a spliced edit". I reversed it in a scratch worktree by changing the guard to `if (error !== undefined)`. Both tests failed, 11 passed and 2 failed.
- No partial move: test/fs/invalidFrontmatter.test.ts "fails update, complete and cancel and leaves every file as it was" compares the whole `disk.tree()` text before and after each write, and the CLI test asserts `tree()` equals ["TODO.md","later/1-bad.md"]. Reopen and update on a done file are pinned by "fails reopen and update and leaves every file as it was".
- Not-a-mapping reversal: I made notMapping not fail. "refuses frontmatter it cannot edit key by key" failed, along with the sequence and scalar fs cases: 25 passed, 3 failed. I restored the file and removed the scratch worktree.

Class check on the predicate, probed against frontmatterEdits at HEAD:
- Fail: duplicate keys `a: 1\na: 2`, tab indentation, `[a]`, `123`, `- a`, `hello`, flow map with a bad alias, a syntax error.
- Splice: block map with `x: *a`, `<<: *a`, an alias after a multi-line `|` scalar, a self-referencing anchor.
- Succeed: empty, `~`, `null`, comment-only, `!!int abc` (no reader error).
- Not tried: multi-document YAML, because the `---` fences make it impossible inside frontmatter.

Implementer's stated deviations (`.success`/`.failure`, `Result.fail(edits.failure)`, the cast on the test array): verified in code, and all are fine.

Checks I ran:
- `bun test test/markdown test/fs/invalidFrontmatter.test.ts test/fs/conformance.test.ts test/cli/frontmatter.test.ts test/boundaries.test.ts`: 342 pass, 0 fail.
- typecheck: clean.
- lint at HEAD: "Found 0 warnings and 0 errors". At base f9c97b4 oxlint printed no warnings line. oxfmt is clean on both.
- check stage `bun run check` (check.command) passed at eb3c46e: 1594 tests.

Stale-text search for the removed phrases "left unchanged", "otherwise the frontmatter is left", "falls back to formatFrontmatter" and "replaced whole", across the repository including todo/ and test/:
- Search proof: base README.md:42 holds "left unchanged".
- Hits are only in todo/later/66 (the task itself) and todo/done/later/65 and 64. Both are dated history, and no live copy remains.

Non-blocking notes:
- src/markdown/README.md: the four new continuation lines of the Frontmatter bullet are indented 3 spaces where the rest of the list uses 2 (`cat -A` shows "···alias included"). It renders the same.
- A valid flow map with a trailing comment (`{a: 1} # c`) still loses the comment when rewritten in block style. This was already the case before this change, and the spec's "MAY be rewritten in block style" allows it.
- Commit eb3c46e is titled docs(spec) but also adds test/cli/frontmatter.test.ts.

Branch: nzila/01M5GY12N5NBDM94VGGKMW955K

nzila run 01M5GY12N5NBDM94VGGKMW955K
