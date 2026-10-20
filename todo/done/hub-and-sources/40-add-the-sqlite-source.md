---
title: Add the SQLite source
group: Hub and sources
completed_at: 2026-10-20T05:58:57Z
outcome: completed
---
Design: [SQLite source design](../../docs/superpowers/specs/2026-10-19-sqlite-source-design.md).

Build a database-backed list: a `SqliteTodoStore` in a new `src/sqlite` module plus a `sqlite` hub source, so `todo projects add --source sqlite` registers a project the CLI and web app open like any other.

Done when:

- `SqliteTodoStore` passes `runConformance` declaring every capability except `promote` (`promote` fails with `Unsupported`): groups, ordering, comments, cancel and full editing, matching `MemoryTodoStore` semantics.
- `src/sqlite` defines a `SqliteDriver` Effect service (open, run, query, transaction); the CLI provides it from `bun:sqlite` in `src/cli/bin.ts` and wires `sqliteSource` into `sources: [fs, git, jira, sqlite]`. No module outside the apps imports `bun`.
- The schema holds the list, groups, tasks, comments and positions per the design; each mutation is one SQLite transaction (WAL mode, no `.todo.lock`); the file and tables are created empty on first open, titled with the project name.
- The registry entry takes an optional `path:`, defaulting to `~/.todo-md/projects/<name>/todo.db`; the hub expands `~`. `changes` is `watchList` over the database file and its `-wal`, as jira watches `mirror.json`. Removing a project deletes the file only when the hub placed it; a file at a given `path:` is left alone.
- `package.json` gains the `./sqlite` export, `test/boundaries.test.ts` gains the `sqlite` row (`spec`, `hub`, `effect`) and the `cli` row gains `sqlite`, `src/sqlite/README.md` documents the module, and CLI help for `projects add --source sqlite` has descriptions and examples (`test/cli/help.test.ts`).
- `bun run check` passes.

## Comments

### @nzila at 2026-10-20 05:58:57 +00:00

Done: # Diagnosis: check#3 (commit 742f678, `bun run check`) — 1 failure, external, no change justified

#### What failed

`MemoryTodoStore without cancel > update clears the assignee with null and replaces tags without duplicates` failed with the sandbox error only — no assertion failure:

```
error: this test wrote outside its temporary directory, into /Users/lemol/.todo-md:
  + cache/29mnn3d3lze.json
```

Same signature as check#2's three sandbox failures. The suite is otherwise green (my fixed conformance case passed in this gate: `move to the end of its own section ... [386.35ms]` (pass)).

#### Investigation (observed evidence)

- The escaped file's content begins `{"version":1,"root":"/Users/lemol/Labs/lemolsoft/lemol-workspace/repos/xonton/.worktrees/01M5BWJZFZNKGEBXJ5GM0PX4S0/todo",...}` — a parse cache for another project's list. No code path in this repo's tests reads xonton's todo directory; the victim test uses a pure in-memory store. The write is external (another run's `todo` CLI on this shared machine).
- Timing: file mtime 01:33 local; gate started 05:29:42Z (01:29 local), ran 597s with load1 8.2. The write landed mid-gate.
- Ongoing pattern: `ls -lt /Users/lemol/.todo-md/cache/` shows external writes all night (00:06, 00:15, 00:55, 01:33, 01:41 local) — the shared home is written continuously by other agents/runs, so any ~600s gate run can catch one in some test's `afterEach` window.

#### Head-vs-base (same focused command, per the runbook)

`bun test test/spec/MemoryTodoStore.test.ts`:
- Head (742f678): 102 pass, 15 skip, 0 fail.
- Base (4d2d034, detached probe worktree, removed afterwards): first run 99 pass / 1 fail, then two reruns 100/99... precisely: rerun 1 showed no `(fail)` lines, rerun 2 (logged) 100 pass, 15 skip, 0 fail.

Caveat stated honestly: I did not capture which test failed in that single transient base run (first attempt also used a stale probe path from the rotated attempt ID and errored before running — rerun correctly). It did not reproduce in two subsequent base runs, and a 01:41 external home write overlapped that window. So: the failure reproduces at neither commit deterministically; the one base failure looks like the same external-write flake, but its exact signature is unconfirmed — suspected, not observed.

#### What changed

Nothing. The tree is untouched since the gate (head still 742f678, `git status` clean, probe removed). No code change is justified: the failing assertion is the sandbox guard tripping on another process's file, and the suite passes in isolation at both commits.

#### Recommendation

Unchanged retry: re-run the gate. If sandbox trips keep recurring on long runs, the systemic fix (outside this task's scope) is to make the guard tolerant of unrelated `cache/*.json` parse-cache churn — e.g. ignore `cache/` entries whose `root` points outside the repo — since the machine's home is shared with live agents. Naming it here as a task another project (test infrastructure) may want; not written anywhere outside this worktree.

Review: approved (4/5)
Review #2 of todo-md:40 (Add the SQLite source). Outcome: approved.

I read the whole diff from base 2a3b14b to 62727f4 (28 files, +2028/-39). The branch was restacked from 4d2d034 onto main 2a3b14b. `git range-diff 4d2d034..742f678 2a3b14b..HEAD` shows all eight commits as `=`, so it is a clean rebase with no content change. The commits from main (623fb10, 2a3b14b) touch only src/fs/parsing.ts, test/sandbox.ts and src/fs/README.md. The six do#1 commits are unchanged since review #1, so its walks still hold. This round checks the fixes in d5c0bcc and 62727f4.

#### Earlier findings
- F1 fixed (d5c0bcc, src/sqlite/SqliteTodoStore.ts). `resolvePlacement(where, excludeId?)` counts with `AND id != ?`, and `move` calls `resolvePlacement(where, id)`. Pinned by the new conformance case "move to the end of its own section keeps the moved task before the next add" in src/spec/testing/conformance/moving.ts, which covers both the ungrouped and grouped repros from review #1.
  - Reversal: in a scratch worktree I changed it back to `resolvePlacement(where)`. Then `bun test test/sqlite/conformance.test.ts -t "own section"` gave `(fail) SqliteTodoStore conforms to TodoStore > move to the end of its own section ...` (0 pass, 1 fail). Restored afterwards.
  - Class check: a scratch differential test, not committed, ran 60 seeded random sequences of 40 operations each against MemoryTodoStore and SqliteTodoStore. The operations were add to ungrouped/G/H, move to the end of a group, before an anchor or after an anchor (including cross-group and invalid moves), complete and reopen. All 60 final layouts were equal (1 pass, 60 expects). With the fix reverted, the same test failed at seed 1, so the generator does produce the bug class. Not covered: cancel, remove, renameGroup and update interleaved with moves. Those code paths are untouched by this round.
  - Anchored moves read the anchor's position after the moving row is shifted out (position -1). The `position >= index` shift cannot touch the -1 row, so excluding it from the count only affects the end-of-group case.
- F2 fixed. The three spots are updated: docs/architecture/sources.md drops `*(planned)*`, docs/architecture/README.md reads "fs, git, jira and sqlite", and "(`git`, `jira` and `sqlite` are built)" gains a `sqlite ─► hub` diagram line.
  - Search at HEAD: `rg -n "fs, git or jira|fs, git and jira|git. and .jira. are built|\(planned\).*sqlite|sqlite\*? \*\(planned|sqlite/driver|driver\.test"` returned nothing.
  - Proof that the search works: run against `git show 4d2d034:docs/architecture/README.md`, it found line 12 "fs, git and jira" and line 61 "(`git` and `jira` are built)". Against `git show 95af519:docs/architecture/sources.md`, it found line 86 `sqlite** *(planned)`.
  - Value search `fsSource, gitSource, jiraSource]` found three hits:
    - docs/superpowers/specs/2026-09-13-hub-design.md:42 is the historic design, dated.
    - src/jira/README.md:26 is a jira-only wiring example, illustrative.
    - src/web/server.ts:49 is live, but it is the tests-only fallback and now carries a comment explaining why sqlite is absent.
- F3 fixed. test/sqlite/driver.test.ts was moved to test/cli/sqlite-driver.test.ts (a 100% rename), next to src/cli/BunSqliteDriver.ts. The rest of test/sqlite mirrors src/sqlite.
- F4 fixed. In BunSqliteDriver `transaction`, `BEGIN` and the `onExit` ROLLBACK are now inside `Effect.uninterruptibleMask((restore) => ...)`, and the body runs as `restore(effect)`, so no interruption can land between BEGIN and the rollback finalizer. No test interrupts a transaction. It was low severity and is correct by reading.
- 62727f4 adds `"add"` to the new case's `requires`. That matches the convention in case.ts for cases that call `store.add`, and it fixed check#2's failure in "MemoryTodoStore without add".

No new findings.

#### Done when, item by item (unchanged from review #1 except where noted)
1. Conformance with every capability but promote: test/sqlite/conformance.test.ts; store.test.ts "a new file starts empty, titled, with every capability but promote". "Matching MemoryTodoStore semantics" now holds for move as well, per the F1 evidence above.
2. SqliteDriver service, the Bun layer in bin.ts, `sources: [fsSource, gitSource, jiraSource, sqliteSource]`: done. Pinned by test/boundaries.test.ts "lets sqlite use spec and hub, and keeps bun to the apps".
3. Schema, one transaction per mutation, WAL, no lock, created empty and titled: store.test.ts "opens the file in WAL mode, with no lock file beside it" and "keeps the list when reopened, ..."; test/cli/sqlite-driver.test.ts "a failed transaction rolls back whole".
4. path:, default location, `~` expansion, watchList over db and -wal, remove deletes only a hub-placed file: test/sqlite/source.test.ts (path expanded; "removing deletes the file the hub placed and leaves a path file alone"; live change test) and test/cli/sqlite.test.ts.
5. Export, boundaries rows, README, and help: package.json `./sqlite`; help.test.ts "projects add documents the sqlite source and its --path flag", which review #1 already reversed and saw fail.
6. `bun run check`: check.command is `bun run check`, the same command the Done when names. check#5 passed it at 62727f4 ("Ran 1406 tests across 102 files. [45.74s]", gate output /Users/lemol/.nzila/attempts/01M5BXX3JC2WQEZB5XD32K14K7/output.log). check#3 and check#4 failed on the sandbox guard tripping on ~/.todo-md/cache, which was external; main's 623fb10 and 2a3b14b fixed that. I did not run the gate.

#### Other walks
- What to build: the task has no numbered list, so the Done-when items above stand in for it.
- Comments: I read todo/hub-and-sources/40-add-the-sqlite-source.md at review time. It has no Comments section, and the brief has no Pre-start task comments. That is 0 comments and no authors.
- Implementer's stated gaps: do#2, do#3 and do#4 state none. do#4 names a test-infrastructure follow-up (make the sandbox tolerant of cache churn). Main has since done it (623fb10), so nothing is left open here.
- nzila's own commits: none on this branch. All eight are conventional implementer commits, each scoped to its fix.
- Focused tests run at HEAD: `bun test test/boundaries.test.ts test/sqlite test/cli/sqlite-driver.test.ts test/cli/sqlite.test.ts test/cli/help.test.ts test/spec/MemoryTodoStore.test.ts test/spec/capabilities.test.ts test/fs/conformance.test.ts` gave 400 pass, 90 skip, 0 fail across 10 files. `bun run lint` printed "All matched files use the correct format".
- Linter: 0 warnings ("Found 0 warnings and 0 errors.", line 8 of the check#5 gate log). The base also had 0.
- Cost at scale: review #1 measured it (add about 19ms at n=2000, linear, like MemoryTodoStore). This round adds one indexed-free COUNT with an extra `id != ?`, which does not change the order of growth.
- Scratch worktree removed. The working tree is clean and I wrote no files to it.

Score: 4. The fixes are correct and pinned by a conformance case all adapters run, and the docs are now current. The quality and tests dimensions stay at 4 because F1 needed a review round to find and F4 has no interruption test.

Branch: nzila/01M5BQ5P8N95H7JETQ2X0G1K4N

nzila run 01M5BQ5P8N95H7JETQ2X0G1K4N
