---
title: A test run leaves its temporary directories behind
tags: [test, cleanup]
group: Read cost
completed_at: 2026-10-21T19:08:06Z
outcome: completed
---
The todo-md:53 controller review (loop `01M5FHVVJ6H539ZGYMN78TTRXJ`, main
`67e4a6b`) counted the `todo-md-*` directories under `$TMPDIR`: 1130 before
one `bun run check` and 1141 after it. One run of the suite leaves eleven:

```
5 todo-md-test-home-*      test/sandbox.ts
4 todo-md-add-*            test/web/projects.test.ts
1 todo-md-cwd-*            test/web/projects.test.ts
1 todo-md-web-git-*        test/web/projects.test.ts
1 todo-md-register-*       test/web/dashboard.test.ts
1 todo-md-load-*           test/web/load.test.ts
1 todo-md-git-templates-*  test/git/helpers.ts (when the git tier runs)
```

The 1130 already there: 783 `test-home`, 140 `add`, 37 `git-templates`,
35 each of `web-git`, `register` and `cwd`, 9 `load`. Every gate of every
run adds to it, on every machine that runs the suite.

Two causes:

1. `test/sandbox.ts` and `test/git/helpers.ts` remove their directory in a
   `process.on("exit", …)` handler, and `bun test` (1.4.3) does not fire
   it. Probe: a test file whose `exit` handler writes a marker file, run
   with `bun test`; the marker is never written.
2. The web tests `mkdtempSync` a directory and never remove it (the
   todo-md:52 review noted this for `load.test.ts` and filed nothing).

Build:

1. Remove each directory by a hook `bun test` does run: `afterAll` in the
   preload for the sandbox home, which runs once per test file, so it needs
   to remove the home after the last file and not before. Or another hook
   that is proven to run. Spawned processes inherit `TODO_MD_HOME`, so
   remove the home only after the whole run.
2. Give the web tests' directories a cleanup (`afterEach`/`afterAll`, or a
   scoped temporary directory like `diskWith`'s).
3. Do not remove directories the run did not create. Other runs on the same
   machine use the same prefixes at the same time (see todo-md:53).

Tests first: a test that runs `bun test` on a small fixture with the
sandbox preloaded, in its own `TMPDIR`, and finds no `todo-md-*` left in
that `TMPDIR` afterwards. It fails today.

Done when: that test passes. Reviewer's check: one `bun run check` with
its own empty `TMPDIR` leaves no `todo-md-*` directory behind, and two
`bun run check` runs at once in one shared `TMPDIR` both pass, so neither
run removed the other's directories.

Out of scope: deleting the directories that are already there. That is
the person's job, and other live runs may still be using some of them.

## Comments

### @agent at 2026-10-21 19:08:06 +00:00

Done: Built both plan tasks, one commit each (e6418e1, 4ea7f36).

1. test/sandbox.ts exports `scratchDirectory(prefix)`. It calls mkdtempSync under tmpdir() and records the path, and a preload `afterAll` removes exactly the recorded paths. The sandbox home and test/git/helpers.ts's git templates use it, replacing both `process.on("exit")` handlers. The new test in test/sandbox.test.ts runs `bun test` on a fixture with the real sandbox preloaded in its own TMPDIR, with `*-elsewhere` dirs pre-made. It failed at base, listing the leaked todo-md-git-templates-* and todo-md-test-home-* dirs, and passes now (6 pass in sandbox.test.ts).
2. The web tests (load, projects, dashboard, asset-mounts) use scratchDirectory. asset-mounts uses the `todo-assets-` prefix, which the task did not list. Same leak, so I fixed it too.

Verified:
- With an empty TMPDIR I ran `bun test` on test/web/{load,projects,dashboard,asset-mounts}.test.ts, test/sandbox.test.ts, test/git and test/cli/git.test.ts. The result was 125 pass, 0 fail, and TMPDIR was empty afterwards.
- `bun run lint` and `bun run typecheck` both exit 0.
- Grep for `mkdtemp|process.on("exit"` in src and test: no `process.on("exit"` remains. The remaining mkdtemp sites are sandbox.ts and sandbox.test.ts, plus the files below, which I did not touch:
  - web: server, fs-e2e, middleware/project
  - cli: web, bin, bundle
  - test/git/helpers.ts `fixture`
  The plan said these remove their own directories. I did not check that.
- I did not run `bun run check`, and I did not run two checks at once in a shared TMPDIR. The concurrent-run requirement is covered only by the `*-elsewhere` assertion in the new test.

Gaps:
- A bare `bun test` over the whole suite was not run to confirm an empty TMPDIR.
- With `--bail`, the preload `afterAll` does not run, so dirs would leak. The repo never passes `--bail`.
- test/web/server.test.ts and harness.ts also create `todo-md-home-*`, `todo-md-list-*`, `todo-md-empty-*` and `todo-md-web-test-*` directories, outside the plan's list. I did not check whether they clean up. A `bun run check` with its own TMPDIR will show it.

Review: approved (4/5)
Review of todo-md:54 (two commits on d591fd0): e6418e1 sandbox home + git templates via scratchDirectory/preload afterAll, 4ea7f36 web dirs via scratchDirectory. Gate check#1 ran `bun run check` on 4ea7f36: passed (1437 tests, 106 files, 56.58s; lint 0 warnings/0 errors; typecheck clean). Approve with notes below; nothing blocking.

TESTS-FIRST / DONE-WHEN (task brief):
- Required test ("bun test on a small fixture with the sandbox preloaded, in its own TMPDIR, finds no todo-md-* left; fails today") is pinned by test/sandbox.test.ts:108 "a run removes the temporary directories it made, and no others". It preloads the real test/sandbox.ts, imports the real test/git/helpers.ts (remoteIn), pre-makes todo-md-test-home-elsewhere + todo-md-git-templates-elsewhere, and asserts readdir|startsWith("todo-md-") equals exactly the two elsewhere dirs (line 154), plus " 1 pass" and exit 0.
- Proven bidirectional: in a scratch copy with sandbox.ts/helpers.ts reverted to base, the test FAILS with + "todo-md-git-templates-Nsrnp3" and + "todo-md-test-home-cUkAvg" (matches plan's predicted diff), and the outer base run also leaks todo-md-test-home-5JELtZ into its TMPDIR. With the fix: `TMPDIR=$RTMP bun test test/sandbox.test.ts` -> 6 pass, 0 fail, TMPDIR empty (observed).
- What the test would have to see to fail: any extra todo-md-* entry in the inner TMPDIR. The toEqual is over filesystem state produced by code under test (genuine pin, not an assertion over a request-supplied literal), so no assertion-reversal was needed; the base-code run above is the reversal.
- Done-when "that test passes": observed (6 pass). Reviewer's check, one `bun run check` with its own empty TMPDIR leaving no todo-md-*: NOT run as a full gate (this stage forbids whole-gate runs; check#1 ran the gate in ambient TMPDIR, not isolated). Subset evidence observed: `TMPDIR=$RTMP bun test test/web/load.test.ts test/web/projects.test.ts test/web/dashboard.test.ts test/web/asset-mounts.test.ts test/sandbox.test.ts` -> 39 pass (plan predicted 39), `ls -A $RTMP` empty. Full `ls -A` covers every prefix including todo-assets-*. Two concurrent checks in one shared TMPDIR: NOT run (forbidden here); covered by mechanism (afterAll removes only exact recorded paths; grep shows no prefix-based deletion in test/sandbox.ts or test/git/helpers.ts) plus the *-elsewhere pin. Left to check/land stages.

BUILD ITEMS:
1. Remove each directory by a hook bun test runs (home only after whole run): done. test/sandbox.ts:43 exports scratchDirectory (mkdtempSync under tmpdir, records path); :51 preload afterAll removes exactly made.splice(0); :57 home goes through it. test/git/helpers.ts:118 templateHome ??= scratchDirectory("todo-md-git-templates-"). Both process.on("exit") handlers gone; grep `process\.on` over test/ src/ returns nothing (exit 1), and the same pattern finds both base lines in the scratch copy (positive control, so the search works). Prefixes unchanged.
2. Web dirs cleanup: done. load.test.ts:8, projects.test.ts:107,120,132,164,233,248, dashboard.test.ts:178, asset-mounts.test.ts:16 all use scratchDirectory; unused mkdtempSync/tmpdir imports dropped. asset-mounts keeps its todo-assets- prefix (same leak class, plan-justified).
3. Remove only what the run created: done. Removal iterates recorded paths only; the new test's elsewhere dirs prove concurrent runs' dirs survive.

COMMENTS: read the task file todo/read-cost/54-a-test-run-leaves-its-temporary-directories-behind.md (54 lines, no Comments section) and the brief (no Pre-start task comments section). Count 0, authors none. Nothing to walk; implementer's report mentions none.

IMPLEMENTER'S GAPS:
1. Bare `bun test` whole-suite isolated-TMPDIR run: missing (not run; forbidden at this stage). Mitigated: single-file and 5-file isolated runs both empty; static audit of every remaining mkdtemp site (below); check#1 green on this commit.
2. --bail skips preload afterAll so dirs would leak: pushed back, accepted. Verified: no --bail in package.json/bunfig.toml/scripts (grep exit 1); package.json:30 test script is plain `bun test`.
3. server.test.ts/harness.ts extra prefixes unexamined: done in this review. harness.ts homeFor dirs are removed by makeRouter close(); every caller closes (projects/dashboard/router/sync/contracts/harness.test via afterEach cleanup arrays; security/events inline). server.test.ts, fs-e2e use afterEach cleanup arrays; middleware/project.test.ts rms inline; cli web/bin/bundle use file-level afterAll; git fixture uses Effect acquireRelease; fs diskWith uses Effect-scoped makeTempDirectoryScoped. No leak found.

COMMITS vs PLAN RULES: e6418e1 touches only test/sandbox.ts, test/git/helpers.ts, test/sandbox.test.ts (plan task 1 files); 4ea7f36 touches only the 4 web tests (plan task 2 files). No commit outside its rule. Plan Decision (scratchDirectory + preload afterAll + recorded-paths-only + same prefixes) matches the code; no Decision contradicted.

CHECK COMMAND: brief's check.command is `bun run check` (= lint && typecheck && test). check#1 ran exactly it on 4ea7f36 and passed. The Done-when names the same command with empty-TMPDIR/two-concurrent qualifiers, which check#1 did not apply. I ran only subsets: `bun run lint` exit 0 (oxfmt clean, 263 files), `bun run typecheck` exit 0, plus the two isolated-TMPDIR bun test runs above. (One parallel-run artifact: lint briefly flagged test/.sandbox-test-*/fixture.test.ts while the sandbox test was running; rerun after: clean. Not a finding.)

OTHER CHECKS: predicate class — cleanup is exact-path, no matcher; the test's startsWith("todo-md-") filter is test-only, and my subset check used full `ls -A` so todo-assets-* is covered too. Tried: base code (fails +2 dirs), fixed code (passes); deliberately did not re-run the prefix-matching known-bad (planner observed it fail; base run shows equal discrimination). Cost at scale: afterAll does one rmSync per recorded dir (~13/run); 5-file subset took 1.87s, full gate 56.58s — no new cost class. No src changes, so no spec impact; boundaries tests passed in the gate log; imports are relative per the module graph. No new module created; new test is colocated in test/sandbox.test.ts. Plan verify steps: base-fail observed (here), 6-pass observed (here), 39-pass+empty observed (here, was unobserved), lint/typecheck exit 0 observed (here and by do). Linter: 0 warnings, no class; base (gate log) 0 warnings/0 errors.

NOTES (non-blocking): (a) web-dir cleanup has no committed pin — only this reviewer's manual TMPDIR check; a future mkdtemp without scratchDirectory would not trip any test. Task required only the one test, so not a defect, but a whole-run TMPDIR assertion would be the durable pin. (b) afterAll rmSync loop is not per-dir fault-isolated; with force:true a throw is unlikely, nits only.

