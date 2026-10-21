# 53 A hub test's temporary list vanishes under concurrent test runs

Run `01M5FV6NF5Y86H3GPDC2HGJ6AH`, loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (width
1). Landed `67e4a6b`. The code is `7c36c15` and `bd7333b`.

## Attempts

- triage#1 started on agy_flash_m. It ran 7 minutes, then hit the
  individual quota (429). cc_sonnet_m triaged it instead and routed it to
  the planned flow.
- plan#1 reproduced the flake: three concurrent `-t autoSync --rerun-each
  400` loops failed 14 of 1200 runs. It showed the `lstat` comes from the
  scope finalizer's `rm -r`, which reports a child's ENOENT under the
  root's path while the tree changes. The writer is the hub: `effectTest`
  closed the layer's scope (the disk) before the test's scope (the hub and
  its `autoSync` fiber), so `writeState` raced the removal.
- do#1 followed the plan:
  - `runEffectTest` now applies `Effect.scoped` first, then the layer;
  - `writeState` is uninterruptible;
  - each change has a test that it saw red at base.
- check#1 passed (1436 tests).
- review#1 approved:
  - it ran the reviewer's check: two concurrent `test/hub --rerun-each 20`
    loops under four CPU burners, 2720 pass each, 0 `NotFound`;
  - it reversed both tests both ways in a scratch worktree.
  - One citation did not open (`../../node_modules/...`).

## Controller review (intensive)

- Done when:
  - The cause is named with the failing message: plan#1's loops
    (`NotFound: FileSystem.makeTempDirectoryScoped (…/todo-md-V2rkPU)`,
    `syscall: "lstat"`).
  - The fix has tests: `test/spec/effectTest.test.ts` "closes the test's
    scope before the layer's" and `test/hub/sync.test.ts` "an interrupted
    sync still finishes the state write it started". Review#1 saw both
    fail with the base code restored.
  - Reviewer's check: on `67e4a6b`, three concurrent `bun test
    test/hub/sync.test.ts -t autoSync --rerun-each 200` gave 200 pass,
    0 fail, 0 `NotFound` each. This is the command that failed 14 of 1200
    at base.
- The "What to build" items are all done. Nobody broadened a glob or
  retried a creation. The task file has no comments.
- Class check for provide-then-scope: `test/hub/helpers.ts` `liveTest`
  already scopes first. `src/spec/testing/conformance/index.ts` provides
  the layer and then scopes, but only to read `capabilities`. It starts no
  fiber, so it is harmless and not filed.
- `bun run check` on main: 1308 pass, 128 skip, 0 fail.
- Not filed: do#1 dropped the blank line between `readState` and
  `writeState`'s doc comment in `src/hub/state.ts`. The lint passes.
- Filed **54**: one `bun run check` left 11 `todo-md-*` directories in
  `$TMPDIR`, and 1130 had built up. The sandbox and git-template homes are
  removed in `process.on("exit")`, and a probe showed that `bun test`
  never fires it. The web tests never remove theirs.
- No timings regeneration: no test files were added, moved or deleted,
  and this repository has no `test/timings.json`.
