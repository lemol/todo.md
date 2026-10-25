# 51 The fs watch test that skips git's directory is flaky under load

Run `01M5FRMZVN018V0P7SJJ7DQB62`, loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (width
1). Landed `5542b21`; the code is `9401291` (on the branch: `acbb693`).

## Attempts

- triage#1 routed it to the planned flow. For a one-file test change that is
  too heavy: the plan took 23 minutes of the run's 36.
- plan#1 named the sandbox guard of `a1df35a` (it watched the hub's `cache/`,
  fixed by `ea846d9`, todo-md:48) as the cause, not late FSEvents. It scoped
  the change to `test/hub/fs.test.ts`.
- do#1 added a raw `FileSystem.watch` tap (`watching`) and a `quiet` window
  that excuses an emission only when a raw path the window's own write does
  not claim arrived after the last emission. It applied them to both
  arm-then-settle tests, with no window lengthened. Red first: an injected
  late probe write failed the old test and passed the new one. It reproduced
  the old-guard failure in scratch (`~ cache/list.json`, 1236.20ms), and
  `--rerun-each 50` under load gave 300/0.
- check#1 passed (1433 tests).
- review#1 approved. Under its own load it re-ran `--rerun-each 50` (300/0),
  removed the debounce (the burst test fails 40/40) and reversed both `seen`
  assertions. It noted that `own` claims nothing on a platform reporting
  absolute paths, which would weaken the test rather than fail it. It also
  saw an unrelated `autoSync` `NotFound` flake.

## Controller review (intensive)

- Done when:
  - Cause named, with the failing message as evidence. The original message
    was never captured, so this was pushed back and accepted, and the
    reproduced guard failure stands in for it. One more fact supports it: the
    git test passes in ~1.25s here (junit time 1.2536s at `5542b21`), which
    matches the reported 1239.83ms. An assertion failure in the git quiet
    window ends near 0.72s (do's injected run: 724ms). So the failing run got
    through the whole body, which fits a failure after the test from the
    guard, not one in the window.
  - `--rerun-each 50` under load. Observed by the reviewer, log at
    the attempt's `proof/loaded-rerun.log`.
- Sibling `emits once per burst …`: same `arm` and `quiet` helpers.
- `not.toMatchObject({ emitted: true, late: [] })` fails only when the test
  emitted and nothing late excuses it, because Bun matches arrays by length.
  The reviewer's debounce mutation shows that it bites.
- Residual weakness: an unclaimed late event in the same window masks a
  regression for one run. The brief chose this design, so no task.
- On `5542b21`, `bun test test/hub/fs.test.ts` gave 6 pass.
- No test files were added, moved or deleted, so there is no timings
  regeneration.
- Filed **53**: the reviewer's out-of-diff
  `NotFound: FileSystem.makeTempDirectoryScoped` in
  `autoSync > syncs every syncable project one interval after startup`,
  under two concurrent `bun test test/hub` loops.
