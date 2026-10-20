---
title: Make the test sandbox's escape guard cheap
tags: [onboarding]
findings: [gate-cost, agent:sandbox-guard-cost]
---
#### Why

`bun run check` ran in 570 s on the trial (1320 tests, 97 files): over the
5 min gate budget (`gate-cost`). Nearly all of it is one hook. The preload
`test/sandbox.ts` registers an `afterEach` that calls `snapshotOf` on
`todo/` and on the real hub (`$TODO_MD_HOME` or `~/.todo-md`), and
`snapshotOf` *reads and hashes every file's contents*. On this machine the
hub holds 397 files, 748 MB of them under `cache/`, so every test — a pure
`parseMetadataLine` case included — pays ~400-550 ms of disk reads and
hashing (`agent:sandbox-guard-cost`). The per-test durations in the trial
log sum to 568 s; tests that do no I/O at all show the same ~500 ms floor.
The suite's speed also depends on the size of whoever runs it's hub, which
it should not.

#### Settled decisions

- Keep the guard and its per-test attribution: an escape still fails the
  test that made it, with the same `+` / `-` / `~` report.
- Snapshot with `stat`, not content: each line is the path plus size and
  `mtimeMs` (and, if cheap, `ino`). No file is read. A rewrite that keeps
  both size and mtime goes unnoticed; that is accepted.
- Do not exclude directories (`cache/` or others) from the guard; stat-only
  makes their size irrelevant.
- No gate split and no `landGate`: once the guard is cheap the suite is
  expected to fit the budget as one tier.

#### What to build

Change `snapshotOf` in `test/sandbox.ts` to record `path size mtime` from
`statSync` (or the `Dirent` plus one `statSync`) instead of hashing
`readFileSync`. Update the doc comment and the `~ rewritten` wording if
needed. Nothing outside `test/sandbox.ts` and its test changes.

#### Tests first

Add `test/sandbox.test.ts` (or extend an existing test of the sandbox, if
one exists) that, against a temporary directory and not the real hub:

- a file added, removed or rewritten with new contents is reported as
  `+`, `-` or `~` respectively by `changesBetween(snapshotOf(before), …)`;
- `snapshotOf` does not open file contents (e.g. a file with no read
  permission is still snapshotted, or a spy on `readFileSync` stays
  uncalled).

Export what the test needs from `test/sandbox.ts` without changing what the
preload does.

#### Done when

- `snapshotOf` reads no file contents; the new tests pass.
- `bun test test/markdown/metadata.test.ts` reports per-test times in the
  low milliseconds rather than ~500 ms, with the real hub unchanged.
- The deliberate-escape behavior still holds: a test that writes into
  `todo/` fails with the guard's message (covered by the new tests on a
  temporary directory).

#### Out of scope

- Splitting the gate into tiers or adding a `landGate`.
- Speeding up the git-store conformance tests (~1 s each); revisit only if
  the suite is still over budget after this lands.
- Anything about what writes `~/.todo-md/cache`.

onboard:01M5BVEFKSMMYD68H9E303YCWJ:tasks/make-the-test-sandbox-guard-cheap.md
