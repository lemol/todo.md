---
title: Make the test sandbox's escape guard cheap
tags: [onboarding]
findings: [gate-cost, agent:sandbox-guard-cost]
completed_at: 2026-10-20T16:42:59Z
outcome: completed
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

## Comments

### @agent at 2026-10-20 16:42:58 +00:00

Done: Implemented and committed stat-only escape snapshots in test/sandbox.ts; no content reads or hashing, and no cache exclusion. Exported snapshotOf/changesBetween, retained per-test guard attribution and +/-/~ reports, and updated metadata wording. Snapshot parsing preserves paths containing spaces.

Added test/sandbox.test.ts: temporary-directory add/remove/rewrite reports, readFileSync spy plus exact stat metadata assertion, and child-process deliberate escape into a temporary repository's todo/ that fails with the guard message.

Test-first evidence: initial focused run had 1 pass and 1 expected failure (readFileSync called once); implementation made it green. Existing change reporting already passed before implementation. Final focused run: 25 pass, 0 fail, 152 ms total; metadata cases measured 0.48–4.59 ms. Exact requested command bun test test/markdown/metadata.test.ts also passed 22/22 (150 ms total). Real hub was only statted by the guard, never written.

Verification: bun run lint and bun run typecheck both passed. Earlier lint failures were formatting in both changed files, then one padding-line error; both corrected and rerun successfully. Search: rg -n 'snapshotOf|changesBetween|sandbox|unguarded' test src found only test/sandbox.ts, with no other harness consumers. Full gate intentionally not run, per step instructions; check stage owns it. No manifests or files outside the requested sandbox/test scope changed.

Review: approved (5/5)
Approved. Reviewed the entire diff from 43bd4ef through 92d5992; no findings. The only commit, 92d5992, answers this task's stat-only guard requirement and changes only test/sandbox.ts and its colocated test. No orchestrator housekeeping commits require separate justification. The branch is unchanged by review; detached scratch worktrees were removed.

Comments checked: read the brief (no Pre-start task comments supplied) and the complete current todo/44-make-the-test-sandbox-s-escape-guard-cheap.md (no Comments section). Comment count: 0; authors: none. There are no comment requests to disposition.

What to build (the brief has one unnumbered paragraph): done. test/sandbox.ts snapshotOf (line 34) uses directory entries and one statSync per regular file, recording path, size, mtimeMs and ino. It never reads contents. Both helpers are exported. The snapshot doc describes the accepted metadata-preserving blind spot; changesBetween (line 69) now describes '~' as metadata changed. The cache exclusion is removed, as explicitly required. Preload home isolation, per-test afterEach, message and baseline update remain intact. No gate split, landGate or unrelated optimizations.

Required cases and failure sensitivity:
- Add/remove/rewrite with + / - / ~: pinned by test/sandbox.test.ts:8, 'reports added, removed and rewritten files, including paths with spaces and cache'. Its fixture really deletes one file, adds another, and grows the cache file from 'old' to 'new contents'; the assertion fails on an incorrect marker, missing entry, wrong path or extra entry. Reversed the expected markers in a detached scratch worktree: 2 pass / 1 fail, with actual '+ added', '- removed', '~ cache/with spaces' versus reversed expectations (markers-reversal.log).
- No content reads and exact stat metadata: pinned by test/sandbox.test.ts:60, 'snapshots file metadata without reading contents'. A readFileSync call or a snapshot differing from independently obtained stat fields fails. Reversed the no-read expectation in scratch: 2 pass / 1 fail, 'Expected number of calls: >= 1; Received number of calls: 0' (reversal.log). Inspection also rules out replacement content-reading APIs.
- Deliberate escape attribution: pinned by test/sandbox.test.ts:28, 'the preload attributes an escape to the test that writes it'. Its isolated subprocess writes the temporary repository's todo/escaped; success exit, missing guard message or absent '+ escaped' would fail. This exercises the real preload in a child, not a simulated error. Child output and nonzero exit are observed by the test.
- Metadata timing: reran the exact requested command, bun test test/markdown/metadata.test.ts: 22 pass / 0 fail, 77 ms total, individual cases 0.45–3.93 ms (metadata.log). Focused combined command bun test test/sandbox.test.ts test/markdown/metadata.test.ts: 25 pass / 0 fail, 102 ms total. No review writes targeted the real hub; the scale probe's before/after hub snapshots were identical.

Class checks beyond the added examples: scratch probe exercised missing directory, empty snapshot, same-size rewrites with explicitly advanced mtime, spaces, leading/trailing spaces, tabs, numeric suffixes and quotes in filenames, and renames exposing both old and new names. All 13 expectations passed. No property generator is introduced. Newline filenames were deliberately not tested: newline-delimited snapshots already did not support them before this change. Symlink traversal and directory-only changes remain the pre-existing regular-file guard scope. Between listing and stat, deletion is caught and skipped; a later snapshot sees subsequent surviving state. This is a sampled guard, not an atomic filesystem journal; metadata-preserving rewrites are explicitly accepted by the task. Baseline advancement after an escape is unchanged.

Scale evidence: command REVIEW_HUB="${TODO_MD_HOME:-$HOME/.todo-md}" bun test test/review-probe.test.ts in detached scratch, using 400 sparse files under cache/, each 2 MiB: 'scale: 400 files, 800 MiB logical, 100 snapshots ms: 205.163625'. The same probe reported 'real hub files: 8 100 snapshots ms: 36.90270899999996 unchanged: true'. These are observed measurements, not the historical 397-file trial repeated as a current count. Sparse allocation is appropriate here because stat cost must not depend on logical content size. Probe: 1 pass / 0 fail (probe.log).

Verification and gaps: the implementer's only stated deferral was the full gate, correctly left to check. It is now closed by check#1: check.command was bun run check, passed at 92d5992, 1418 tests across 104 files in 42.85 s. This differs from the focused Done-when command; both were run by their respective stages. I did not rerun the whole gate. Recorded check output shows 0 lint warnings and 0 errors (no warning class); base lint also emitted no warnings, and both base and final bun run lint exited successfully. A temporary lint invocation while the nested scratch worktree existed hit duplicate plugin registration from scanning both copies; after scratch removal the final lint passed. This was review setup, not a branch defect. Typecheck success is recorded in the passed check log. Historical test-first failure is implementer-reported; review independently observed the assertion reversals above.

Stale-text search: first validated 'Every file below|rewritten|parse cache' against git show 43bd4ef:test/sandbox.ts (matched the old snapshot comment, '~ rewritten' and cache comment). Then searched the whole tree including hidden .agents files with rg --hidden, excluding .git and node_modules. Other 'rewritten' occurrences concern Markdown writers or historical task records; the task's '~ rewritten' wording is an instruction, not a stale API description. The changed metadata format is local to the exported test helpers and preload. No production config, API, migration or new module directory is introduced.

