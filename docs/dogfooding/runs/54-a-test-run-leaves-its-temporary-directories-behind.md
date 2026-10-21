# 54 A test run leaves its temporary directories behind

Run `01M5FX034Q2TARN6M0MV1JV05N`, loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (width
1). Landed `fceb4e2`. The code is `59f196f` and `d632075`.

## Attempts

- triage#1 (oc_go_spark_xh) assessed the task as moderate infrastructure
  work and routed it to the planned flow.
- plan#1 probed bun 1.4.3. A preload's `afterAll` runs once, after the
  last file, even when a test fails. It does not run under `--bail`.
  `exit` and `beforeExit` never fire. The plan had no Files block, so
  nzila noted that it checked no overlap. That cost nothing at width 1,
  and nzila:572 covers it.
- do#1 added `scratchDirectory(prefix)` to `test/sandbox.ts`. The
  preload's `afterAll` removes exactly the paths it recorded. The sandbox
  home, the git templates and the web tests' directories (including
  `todo-assets-`) use it.
- check#1 passed (1437 tests).
- review#1 approved. It reversed the fix at base and audited every
  remaining `mkdtemp` site. Note (a): no committed test catches a future
  raw `mkdtemp` that never removes its directory.

## Controller review (intensive)

- Done when:
  - The test is pinned by `test/sandbox.test.ts`, "a run removes the
    temporary directories it made, and no others". In a scratch copy I
    replaced the `afterAll` removal with `void dir`. The test then failed
    with `+ "todo-md-git-templates-zpuXMD"` and
    `+ "todo-md-test-home-XFFZXJ"`, and the outer run left two
    `todo-md-test-home-*` directories behind.
  - Reviewer's check, part one: `TMPDIR=<empty> bun run check` on
    `fceb4e2` gave exit 0 (1309 pass, 128 skip, 0 fail), and `ls -A` on
    that TMPDIR was empty. That covers every prefix, the git tests
    included.
  - Reviewer's check, part two: two `bun run check` runs at once in one
    shared TMPDIR, which already held a `todo-md-test-home-other`. Both
    exited 0 (1437 tests each), and only `todo-md-test-home-other` was
    left.
- Build items 1 to 3 are done, as review#1 walked them. Comments: the task
  file's only comment is nzila's own closing comment, and the brief had
  none.
- do#1's stated gaps:
  - The whole-suite isolated run is done by the check above.
  - The `--bail` gap is pushed back: the repository never passes
    `--bail`.
  - The `server.test.ts` and `harness.ts` prefixes are done: review#1
    audited them, and the empty TMPDIR confirms it.
- Not filed, carried here: review#1's note (a). A future raw `mkdtemp`
  under `tmpdir()` would leak without failing any test. One fix would be
  for the preload to point `TMPDIR` at a per-run scratch directory, so the
  run removes whatever lands there. Nothing leaks today, and that design
  needs the person's call.
- Not filed: an `rmSync` that throws in the `afterAll` loop would skip
  the directories after it. With `force: true` that is unlikely.
- No timings regeneration: `test/sandbox.test.ts` gained a test but no
  test file was added, moved or deleted, and this repository has no
  `test/timings.json`.
- Friction to report to nzila: the skill's `scripts/rating.ts` runs
  `bin.ts show` under the current git toplevel, so it fails from a todo-md
  worktree (`events.filter is not a function`). It works when run from the
  nzila checkout.
