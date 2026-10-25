---
title: A hub test's temporary list vanishes under concurrent test runs
tags: [test, flake]
group: Read cost
completed_at: 2026-10-21T18:48:37Z
outcome: completed
---
The todo-md:51 reviewer (attempt `01M5FTCRMQNB85Q866PVM1QDEF`, main `9401291`)
ran two `bun test test/hub` loops at once beside six CPU burners, and one of 48
runs failed `autoSync > syncs every syncable project one interval after
startup` (`test/hub/sync.test.ts`):

```
error: NotFound: FileSystem.makeTempDirectoryScoped (/var/folders/…/T/todo-md-NkoIpl)
 method: "makeTempDirectoryScoped",
 syscall: "lstat",
ENOENT: no such file or directory, lstat '/var/folders/…/T/todo-md-NkoIpl'
```

Log: `<attempts>/01M5FTCRMQNB85Q866PVM1QDEF/proof/loaded-rerun.log.loop1`,
from line 155. The directory is the `diskWith` root (`test/fs/helpers.ts`,
`fs.makeTempDirectoryScoped({ prefix: "todo-md-" })`). Something removed a
temporary directory the test had just made, or one the scope had already
removed. Nobody has found which. Two gates on one machine (concurrent runs of
a loop) is the normal case, so the same failure can fail a gate.

Build:

1. Reproduce it: two or three `bun test test/hub --rerun-each 20` loops at
   once, under load. Record the failing message and the test.
2. Name the cause with evidence. For example: does the `lstat` come from
   creation or from the scope's finalizer? Does any code under test, or
   `test/sandbox.ts`, remove a path under `tmpdir()` that it did not create?
3. Fix the cause, not the window. Do not give a removal a broader glob, and
   do not retry the creation.

Tests first: a test that fails while the cause is in place, for example two
scoped disks whose cleanup orders overlap, or whatever step 2 names.

Done when: the cause is named with the failing message as evidence, and the
fix has a test. Reviewer's check: two concurrent `bun test test/hub
--rerun-each 20` loops under load show no `NotFound` for a `todo-md-`
directory.

Out of scope: the fs watch timing windows (todo-md:51).

## Comments

### @agent at 2026-10-21 18:48:37 +00:00

Done: todo-md:53 implemented per plan (<attempts>/01M5FVMGY4GNWZ90TA571H6J3P/plan.md), two commits on the run's branch over 46fe26b. I agreed with the plan's cause throughout; no deviations except a type-level cast noted below.

Cause (taken from the plan, verified against this tree): the `lstat` in `NotFound: FileSystem.makeTempDirectoryScoped (…/todo-md-XXXXXX)` comes from the scope finalizer's `rm -r`, not creation — `@effect/platform-node-shared` builds `makeTempDirectoryScoped` as `acquireRelease(mkdtemp, dir => orDie(rm(dir, {recursive:true})))` (checked: `grep -n makeTempDirectoryScoped node_modules/@effect/platform-node-shared/src/NodeFileSystem.ts` shows the acquireRelease shape; mkdtemp performs no lstat). Nobody else deletes the root: `grep -rn "remove(" src test/sandbox.ts test/fs/helpers.ts` shows removals only of files the code created (locks, `.tmp`, moved-aside dirs). The writer during removal is the hub: base `effectTest` ran `Effect.provide(effect, layer)` inside one `Effect.scoped`, so the disk layer's scope closed before the test scope holding the hub, its autoSync fiber and watchers; the autoSync test ends on `Queue.take` before `writeState` runs, so the sync's mkdir/write/rename raced the `rm -r`.

Fix 1 — commit 43e057c `fix(spec): close an effectTest's scope before its layer's (todo-md:53)`: new exported `runEffectTest` in `src/spec/testing/effectTest.ts` applies `Effect.scoped` to the effect first, then provides the layer (the order `liveTest` already used); `effectTest` delegates to it, signatures unchanged; README row notes the scope order. Test-first: added `closes the test's scope before the layer's` to `test/spec/effectTest.test.ts`; with the base composition it fails with exactly the plan's known-bad (`["layer","test"]` vs `["test","layer"]`, observed by temporarily restoring the base composition), passes with the fix. One deviation: the first version failed `typecheck` (`Exclude<R, …>` does not reduce for a generic `R` when providing `TestEnv` afterward), so the final `provide` target carries an `as Effect<A, E | LE>` cast, same style as the old code's cast; folded into the task-1 commit via autosquash.

Fix 2 — commit 955ad39 `fix(hub): finish a state write a sync started, even when interrupted (todo-md:53)`: `writeState` in `src/hub/state.ts` is wrapped in `Effect.uninterruptible` (whole mkdir/temp-write/rename/cleanup step; the source's `sync` stays interruptible); README `state.json` bullet extended. Test-first: added `sync > an interrupted sync still finishes the state write it started` to `test/hub/sync.test.ts` (gated `writeFileString` via the existing `wrapFs` hook in `test/hub/helpers.ts`, interrupt mid-write, assert `state.json` lands); it fails at base with exactly the plan's known-bad (`- ".todo-md/projects/m/state.json"`, observed before the fix), passes after.

Verification (each as a separate command, all in the worktree): `bun run lint` clean (oxfmt + oxlint, also re-run after the cast fix); `bun run typecheck` clean; `bun test test/spec test/fs test/hub` → 541 pass, 86 skip, 0 fail; `bun test test/spec/effectTest.test.ts test/hub/sync.test.ts` → 13 pass, 0 fail. Searches run and reported: `grep -rln effectTest src test` (all suites use it; full-suite coverage left to the `check` stage per plan) and `grep -rn "writeState|state.json" src test` (only caller is `src/hub/sync.ts`; pinning suites `test/hub/status.test.ts` and `sync.test.ts` were in the focused run). No failures seen, so no base-comparison reruns were needed. Worktree clean, no scratch worktrees or probe links left, nothing written outside the worktree.

Not run (reviewer's check, for the review step): two concurrent `bun test test/hub --rerun-each 20` loops under load. Deliberately not run by hand per the plan's instruction that concurrent full-suite runs on one machine are the reviewer's gate.

Review: approved (5/5)
Approved the run's branch (`955ad3909f070c30414c400fcee925766abc39e5` over base `46fe26b2c5133ef2448a882ad3fc9d77917c76db`, two commits: `43e057c` and `955ad39`).

#### 1. Task Comments
- Read the brief (no `Pre-start task comments` section) and `todo/read-cost/53-a-hub-test-s-temporary-list-vanishes-under-concurrent-test.md:1-42` at review time.
- Comment count: 0 (`none`); authors: none.

#### 2. Numbered "What to build" Items
1. **Reproduce it: two or three `bun test test/hub --rerun-each 20` loops at once, under load. Record the failing message and the test.** — **Done** (`plan.md:11`, logs in `<attempts>/01M5FVMGY4GNWZ90TA571H6J3P/probe/loop{1,2,3}.log`: 14 of 1200 runs across 3 loops failed `(fail) autoSync > syncs every syncable project one interval after startup` with `error: NotFound: FileSystem.makeTempDirectoryScoped (/var/folders/yf/tsckr3ss2_scxcnl3lwn90vr0000gn/T/todo-md-V2rkPU)`, `syscall: "lstat"`, matching `<attempts>/01M5FTCRMQNB85Q866PVM1QDEF/proof/loaded-rerun.log.loop1:171-180`).
2. **Name the cause with evidence.** — **Done** (`plan.md:12-15`, `do#1` summary):
   - `lstat` comes from the scope finalizer's `rm(directory, { recursive: true })`, not `mkdtemp`: verified in `../../node_modules/@effect/platform-node-shared/src/NodeFileSystem.ts:203-210` (`Effect.acquireRelease(makeDirectory(options), (directory) => Effect.orDie(removeDirectory(directory, { recursive: true })))`).
   - No code under test or `test/sandbox.ts` removes foreign paths under `tmpdir()`: verified via `grep -rn "remove(" src test/sandbox.ts test/fs/helpers.ts test/hub/helpers.ts` and `test/sandbox.ts:37-40`.
   - When a directory tree mutates while Bun's `fs.promises.rm(root, { recursive: true })` walks it, a missing child is reported as `ENOENT lstat` with `path: root` (verified in `<attempts>/01M5FVMGY4GNWZ90TA571H6J3P/probe/rmrace.ts:1-26`).
   - Two causes allowed the hub to write into `root` during `rm -r`:
     1. `effectTest` (`src/spec/testing/effectTest.ts`) previously ran `Effect.provide(effect, layer).pipe(Effect.scoped, ...)`, closing the `diskWith` layer scope before the test scope holding `hubOn`'s `autoSync` fiber (`test/hub/helpers.ts:53`, `test/hub/sync.test.ts:245-252`, where `memorySource.sync` offers to `synced` before `makeSyncer` calls `writeState` at `src/hub/sync.ts:61-78`).
     2. Even when the test scope closes first, interrupting the `autoSync` fiber mid-`writeState` (`src/hub/state.ts:48-63`) let an in-flight async fs operation or `onError` temp-file removal race `rm -r`.
3. **Fix the cause, not the window. Do not give a removal a broader glob, and do not retry the creation.** — **Done** (`src/spec/testing/effectTest.ts:12-23,51` applies `Effect.scoped(effect)` before `Effect.provide(..., layer)`; `src/hub/state.ts:48-63` wraps `writeState` in `Effect.uninterruptible`). Neither `test/fs/helpers.ts:32` nor `test/sandbox.ts:40` was given a broader glob, `force: true`, or creation retry.

#### 3. Required Cases and Tests ("Tests first" and "Done when")
- **Test 1 (scope closing order):** Pinned in `test/spec/effectTest.test.ts:26-40` (`closes the test's scope before the layer's`).
  - Asserts `expect(closed).toEqual(["test", "layer"])` (`test/spec/effectTest.test.ts:39`).
  - To fail, `closed` must differ from `["test", "layer"]` (e.g. `["layer", "test"]` when the layer finalizer runs before the test scope finalizer).
  - Reversed in a scratch worktree:
    - Reversing the `expect` literal to `["layer", "test"]` failed: `error: expect(received).toEqual(expected)`, `- "layer", "test", + "layer"`.
    - Restoring the base composition (`Effect.provide(effect, layer)` inside `Effect.scoped`) failed: `error: expect(received).toEqual(expected)`, `- "test", "layer", + "test"`.
- **Test 2 (uninterruptible `writeState`):** Pinned in `test/hub/sync.test.ts:160-192` (`sync > an interrupted sync still finishes the state write it started`).
  - Asserts `expect(yield* disk.tree()).toEqual([".todo-md/projects.yaml", ".todo-md/projects/m/state.json"])` (`test/hub/sync.test.ts:186-189`).
  - To fail, `.todo-md/projects/m/state.json` must be absent (or a `.tmp` file left behind) after `Fiber.interrupt(sync)` completes while `writeFileString` was gated mid-write.
  - Reversed in a scratch worktree:
    - Removing `".todo-md/projects/m/state.json"` from the expected array failed: `error: expect(received).toEqual(expected)`, `+ ".todo-md/projects/m/state.json"`.
    - Restoring base `src/hub/state.ts` (without `Effect.uninterruptible`) failed: `error: expect(received).toEqual(expected)`, `- ".todo-md/projects/m/state.json"`.
- **Done when — Reviewer's check (`two concurrent bun test test/hub --rerun-each 20 loops under load show no NotFound for a todo-md- directory`):**
  - Executed in this review alongside 4 CPU burner processes (`<attempts>/01M5FW98Q8DHA2ADT01N68ZPBN/hub1.log` and `hub2.log`):
    - `hub1.log`: `2720 pass`, `0 fail`, `6460 expect() calls`, `Ran 2720 tests across 14 files. [107.14s]`, `exit 0`.
    - `hub2.log`: `2720 pass`, `0 fail`, `6460 expect() calls`, `Ran 2720 tests across 14 files. [107.84s]`, `exit 0`.
    - `grep -c "NotFound: FileSystem.makeTempDirectoryScoped"` on both logs: `0` and `0`.
    - `grep -c "todo-md-"` on both logs: `0` and `0`.
  - Also ran two concurrent `bun test test/hub/sync.test.ts --rerun-each 20` loops under 4 CPU burners (`sync-loop1.log` and `sync-loop2.log`): `200 pass, 0 fail` each (`5.70s` and `5.69s`), `0` `NotFound`.

#### 4. Implementer's Stated Gaps & Decisions
- **Gap 1 (in `do#1` prose):** Two concurrent `bun test test/hub --rerun-each 20` loops under load were left for the reviewer's gate. **Done** — run and verified in this review (`hub1.log` and `hub2.log` above).
- **Pushback / out-of-scope note (`plan.md:129`):** `src/hub/registry.ts:135-141` (`projects.yaml.tmp` write) has the same orphaned-op shape if interrupted, left unchanged because `registry.update` (`src/hub/registry.ts:155-181`) only runs in the caller's fiber (`add`/`remove`/`rename` in `src/hub/Hub.ts`), which callers/tests await, never in a background fiber like `autoSync`. **Pushed back (valid):** verified in `src/hub/registry.ts:135-181` and `src/hub/sync.ts:59-87`.
- **Decisions:** Both plan decisions (closing `effectTest`'s scope before `layer`'s, and making the whole `writeState` step uninterruptible while keeping `source.sync` interruptible) match the code in `src/spec/testing/effectTest.ts:12-23` and `src/hub/state.ts:48-63`.

#### 5. Commits, Check Command, and Linter Baseline
- **Commits:**
  - `43e057c2b2c21a7f1ca90fd7e067710929d3267c`: `fix(spec): close an effectTest's scope before its layer's (todo-md:53)` — matches Plan Task 1 (`src/spec/README.md`, `src/spec/testing/effectTest.ts`, `test/spec/effectTest.test.ts`).
  - `955ad3909f070c30414c400fcee925766abc39e5`: `fix(hub): finish a state write a sync started, even when interrupted (todo-md:53)` — matches Plan Task 2 (`src/hub/README.md`, `src/hub/state.ts`, `test/hub/sync.test.ts`).
- **Check command:** `check.command` is `bun run check` (`bun run lint && bun run typecheck && bun run test` in `<attempts>/01M5FW7KYTM4GRVGZK1KGXQC7F/output.log:2`, passing `1308 pass, 128 skip, 0 fail` across 106 files in `49.59s`). This differs from the Done-when reviewer's check (`two concurrent bun test test/hub --rerun-each 20 loops under load`); `check#1` ran `bun run check`, and `review#1` ran the concurrent `test/hub` loops.
- **Linter warnings:** `0 warnings, all none; base had 0` — verified via `bun run lint` (`oxfmt --check && oxlint`) at base `46fe26b` (`Found 0 warnings and 0 errors`) and at HEAD `955ad39` (`Found 0 warnings and 0 errors`, matching `<attempts>/01M5FW7KYTM4GRVGZK1KGXQC7F/output.log:8`).

#### 6. Predicates, Searches, Quantities, and Verification Steps
- **Predicates/guards:**
  - `src/spec/testing/effectTest.ts:17` (`layer === undefined ? scoped : Effect.provide(scoped, layer)`): tested with `layer === undefined` (`test/spec/effectTest.test.ts:9-16`), `Layer.succeed` (`test/spec/effectTest.test.ts:18-24`), and scoped `Layer.effect` (`test/spec/effectTest.test.ts:26-40`).
  - `test/hub/sync.test.ts:170` (`path.includes("/state.json")`): matches `<root>/.todo-md/projects/m/state.json.<token>.tmp` produced by `src/hub/state.ts:52-58` (`const file = (yield* Path.Path).join(dir, stateFile); const temporary = `${file}.${token.toString(36)}.tmp``) and does not match registry writes (`projects.yaml.tmp` in `src/hub/registry.ts:137`). Windows backslash separators (`\state.json`) were deliberately not tested because `hubOn` (`test/hub/helpers.ts:37`) constructs POSIX paths (`${root}/.todo-md`) on this OS.
- **Searches for changed prose and identifiers (proven against changed files across `src`, `docs`, `test`, `todo`, `.agents`):**
  - `grep -rn "Written atomically via a temporary file and rename" src docs test todo .agents` → matches only `src/hub/README.md:102` (live, updated).
  - `grep -rn "with a scope and test services" src docs test todo .agents` → matches only `src/spec/README.md:27` (live, updated).
  - `grep -rn "Effect.scoped, Effect.provide" src docs test todo .agents` → matches `test/hub/helpers.ts:63`, `test/hub/Hub.test.ts:429,902`, `test/sqlite/store.test.ts:25` (live callers already using the fixed scope-first order), and dated historical plans `docs/superpowers/plans/2026-09-12-spec-module.md:715`, `2026-09-13-hub-foundation.md:1772`, `2026-09-13-hub-sync-changes-overview.md:546`.
  - `grep -rn "runEffectTest" .` → `src/spec/testing/effectTest.ts:12,51` and `test/spec/effectTest.test.ts:5,35` (all live; internal to `spec/testing/effectTest.ts` and its unit test, while `effectTest` in `src/spec/testing.ts:14` is the public test runner used across all suites).
  - `grep -rn "writeState" .` → `src/hub/state.ts:48` (definition, live), `src/hub/sync.ts:6,74` (sole runtime caller, live), and `docs/superpowers/plans/2026-09-13-hub-sync-changes-overview.md:63,205,387,1345,1605,1663,2128` (dated implementation plan).
- **Plan verification steps:**
  - `bun test test/spec/effectTest.test.ts`: observed in plan and re-verified (`3 pass, 0 fail`); known-bad base composition observed failing with `- "test", "layer", + "test"`.
  - `bun test test/hub/sync.test.ts`: observed in plan and re-verified (`10 pass, 0 fail`; `13 pass, 0 fail` together with `effectTest.test.ts`); known-bad base `state.ts` observed failing with `- ".todo-md/projects/m/state.json"`.
  - `bun run lint` and `bun run typecheck`: re-verified clean (`0 warnings, 0 errors`).


Citations that do not open (the verdict stands; a finding may still be right):
- `../../node_modules/@effect/platform-node-shared/src/NodeFileSystem.ts:203-210` path does not exist
