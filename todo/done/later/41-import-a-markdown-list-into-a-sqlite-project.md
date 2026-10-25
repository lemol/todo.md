---
title: Import a Markdown list into a SQLite project
depends_on: [40]
group: Later
completed_at: 2026-10-20T06:23:59Z
outcome: completed
---
Follow-up to "Add the SQLite source" (task 40). Design: [SQLite source design](../../docs/superpowers/specs/2026-10-19-sqlite-source-design.md).

A new SQLite list starts empty. Add a way to fill one from an existing Markdown list — for example `todo projects add --source sqlite --from <dir>` — copying tasks, groups, comments, done tasks and their IDs through the two `TodoStore`s, so a real list can move to a database file on day one.

Done when: the import copies an fs list into a sqlite project with IDs, groups, ordering, comments and done tasks preserved, the CLI help covers the new flag, and tests cover the copy.

## Comments

### @agent at 2026-10-20 06:23:59 +00:00

Done: Addressed review finding F1 (--from with --path into a missing directory) in one new commit.

Fix: `src/cli/commands/projects.ts` now runs `fs.makeDirectory(dirname(file), { recursive: true })` before `importList`. It sits inside the same pipe, so a failure still triggers the `onError` rollback that removes the project. A mkdir error becomes a UsageError.

Test: `test/cli/sqlite.test.ts` "--from with --path creates the missing directory of the database" adds the project with `--path ~/missing/g.db --from g` and asserts the database equals the fs list. Without the fix it fails; with it, it passes.

Pushback: I did not reuse `SqliteSource.databaseFile`. The CLI already computes the path itself, and the review offered both options, so I took the smaller one. The default-path rule stays duplicated, as it was before.

Verification:
- `bun test test/cli/sqlite.test.ts test/sqlite test/cli/help.test.ts`: 74 pass, 4 skip, 0 fail.
- `bun run lint`: clean.
- `bun run typecheck`: clean.
- Value search: the only changed code is in `projects add`, covered by the files above.

Review: approved (5/5)
Review of todo-md:41 (base f4b60b9..db6f322, 4 commits). F1 from review#1 is fixed; no new findings.

Earlier finding:
- F1 FIXED: `--from` with `--path` into a missing directory now creates `dirname(file)` recursive before `importList` (`src/cli/commands/projects.ts:270`, `yield* fs.makeDirectory(paths.dirname(file), { recursive: true })`). New test `test/cli/sqlite.test.ts:153` "--from with --path creates the missing directory of the database" pins it. Reversal in scratch (drop mkdir, call importList directly) fails that test: expected code 0, got 1 (`test/cli/sqlite.test.ts:163`). With fix, focused suite passes.

Done when, case by case:
- IDs, groups, ordering, comments and done tasks preserved: pinned by `test/sqlite/import.test.ts:80` "copies an fs list with its IDs, groups, order, comments and done tasks" (`expect(copied).toEqual(from)` at :104, `expect(counts).toEqual({open:3,done:3})` at :88, `expect(next.id).toBe("8")` at :110) and `test/cli/sqlite.test.ts:90` "--from copies a Markdown list into the new database, IDs and all" (`toEqual(from)` at :112, next id 8 at :118). Fixture covers empty group with description, promoted task with 2 comments, ticked-but-unswept 05, done in group, cancelled with reason, depends_on. Re-derived: open 1+2=3, done 05+04+03=3, max ID 7 so next 8. Reversals in scratch fail: comment `pos=n-1-i` to `pos=i` swaps Second/First pass and fails `toEqual(from)` at :104; last_id `MAX(last_id,?)` to `MAX(last_id,0)` leaves last_id 0 so next add collides UNIQUE constraint failed tasks.id (fails import test, 6 expects, 0 pass). Done `pos=doneCount-1-i` same class as comments (not re-reversed separately, same INSERT path).
- CLI help covers flag: pinned by `test/cli/help.test.ts:117` `--from string` FLAGS line containing "sqlite only" and :121 example `todo projects add groceries --source sqlite --from ~/notes/groceries`. Code at `src/cli/commands/projects.ts:123-128` (Flag) and :298-301 (example). To fail, help output would have to miss that line or example.
- Tests cover copy: yes. Refusals pinned by `test/cli/sqlite.test.ts:173` "--from into a database that holds tasks fails and leaves no project behind" (code 1, message `already holds a list; import fills only an empty one`, project absent, DB unchanged) and :211 "--from is refused for other sources, a directory without a list and a list with errors" (codes 2, messages for fs project, no list, 1 error). Unit refusal at `test/sqlite/import.test.ts:116`.

What to build: task file `todo/later/41-import-a-markdown-list-into-a-sqlite-project.md` (9 lines) has no numbered list. "Through the two TodoStores": read via FsTodoStore, write bypasses sqlite TodoStore. Plan/do pushed back (add/complete/comment assign fresh IDs and now timestamps, cannot preserve IDs). Accepted: importList writes SQL directly to keep IDs, completed_at, comment times; read side stays through TodoStore.

Comments: read task file (above, no Comments section) and brief (no Pre-start task comments). Count 0, no authors. Nothing to walk.

Implementer's stated gaps: none stated. do#2 prose pushback (did not reuse `SqliteSource.databaseFile`, kept CLI's own `paths.join(home,"projects",info.name,SqliteSource.defaultFile)` at :268) is within review#1's offered options (mkdir OR reuse databaseFile). Duplication pre-existed in c493ff4; smaller diff accepted, not a gap.

Orchestrator commits: none in base..HEAD per brief (f4b60b9, the base, is the commit that closed todo-md:40). The 4 commits are feature commits, no tool-commit rule to check.

Brief Decisions: no Decision table in brief to contradict. Design doc decisions (store+source, no promote, WAL, file location) still hold; design `docs/superpowers/specs/2026-10-19-sqlite-source-design.md:24,121` still calls import a follow-up — dated record, stays, as review#1 noted.

Check command: brief `check.command` is `bun run check`. check#2 passed it on db6f322 (1412 tests across 103 files). I ran focused `bun test test/sqlite test/cli/sqlite.test.ts test/cli/help.test.ts`: 74 pass, 4 skip, 0 fail; plus `test/boundaries.test.ts`: 24 pass total with help+sqlite+import. `bun run lint` clean (oxfmt "All matched files use the correct format" on 258 files, exit 0); gate log on same commit shows "Found 0 warnings and 0 errors" — N=0, M=0, no class, no increment. `bun run typecheck` clean.

Fixture-encodes-bug: checked numbers against fixture totals (above), not code; conformance still passes via gate.

Constraint left out: none. Groups-only DB also refused by same `SELECT (SELECT COUNT(*) FROM tasks)+(SELECT COUNT(*) FROM groups)` (`src/sqlite/importList.ts:37`); correct (groups are state). Warning-only diagnostics do not block (`severity==="error"` filter at `src/cli/commands/projects.ts:248`); correct per spec diagnostics.

Scale (measured, compliant path in attempt dir): `bun <attempt>/scale-probe2.ts` output `open=1000 done=200 importMs=24 counts={"open":1000,"done":200}` and `open=5000 done=1000 importMs=36 counts={"open":5000,"done":1000}`. Single write transaction, linear, tiny.

Spec match: no spec change; `SqliteTodoStore` still `promote:false` (`src/sqlite/SqliteTodoStore.ts:175,899`), README Import section replaces removed "No import" limit. Stale search `rg -n "No import|deferred to a follow" src docs todo test` finds nothing live (exit 0, no hits); same against `git show f4b60b9:src/sqlite/README.md` hits line 103, so search works (hard-wrap safe: short phrase).

Reads-more-than-once/crash: snapshot read before `hub.add`, import after. Concurrent hand-edit between would import stale snapshot; crash between hub.add and import leaves empty registered project (onError rollback only on Effect failure, not kill -9). Same as any two-step CLI; not a finding.

Migration/backfill: import is backfill into empty DB; test opens store holding old shape (fs list), seeds derived values and asserts derived (positions via `toEqual(from)` order, `last_id` via next id 8), not column default. Rows never rewritten N/A (fills empty only).

Predicates class (inputs tried / deliberately not):
- `wrongFor` (`src/cli/commands/projects.ts:196-224`): tried fs+--from (test :211, message "not for fs projects"); git/jira share same helper, same code path — deliberately did not spin git/jira fixtures.
- `listRootOf` (`src/hub/sources/fs.ts:15-26`): tries `<dir>/todo/TODO.md` then `<dir>/TODO.md`, no walk-up. Tests cover both layouts and missing (`b/notes.md`); parent-list non-pickup by code reading. Deliberately did not test symlinks (same `fs.exists` as prod).
- diagnostics error filter: tried 1-error list; warning-only (e.g. cancelled dependency) deliberately not fixture-tested, filter explicit.
- non-empty `total>0`: tried tasks DB; groups-only same query — deliberately no extra fixture.
- `parseInt` NaN skip (`src/sqlite/importList.ts:56-58`): deliberately not tested (spec §1.2 decimal IDs, fs normalizes).
- F1 mkdir: tried missing dir (new test) and existing dirs (other tests); mkdir failure maps to UsageError (code 2) vs source.open SourceError — rare, accepted.

External event: SQLite driver errors map to StoreError (`src/sqlite/importList.ts:13-19,29`), CLI rolls back via `Effect.onError(hub.remove)` (`src/cli/commands/projects.ts:274`) and surfaces code 1 with path message. No retry; correct. No separate log corpus to read; BunSqliteDriver is thin bun:sqlite wrapper.

Module colocation: new `src/sqlite/importList.ts` tested at `test/sqlite/import.test.ts` (mirror of src/sqlite), plus CLI e2e. Boundaries pass (`test/boundaries.test.ts`: sqlite may import spec/hub only — importList imports spec+own driver/store, no fs/bun; cli may import sqlite — projects.ts does).

Quantities: prose counts re-derived above; no stale values. `defaultFile="todo.db"` (`src/sqlite/SqliteSource.ts:22`); CLI duplicates join at :268, source uses `project.dir/defaultFile` at :35 — same file when dir is `home/projects/<name>`, duplication noted but allowed.

Verification steps in plan: prototype 97 pass claimed, typecheck clean, known-bad observed (comment pos, no rollback, diagnostics off). Observed here via reversals (comment pos fail, last_id fail, F1 fail). No predicted-only output.

New flag trace: `--from` Flag at :123 → `absolute()` :228 → `listRootOf` :235 → `FsTodoStore.layer` :260 → `hub.add` :263 → `makeDirectory` :270 → `importList` :272 with `BunSqliteDriver.layer` :273 (composition root CLI). No test-only producers.

Citations are `rg -n`/`Read` lines re-openable; absent claims show search + base hit.

