---
title: The fs watch test that skips git's directory is flaky under load
tags: [test, flake]
group: Read cost
completed_at: 2026-10-21T18:13:45Z
outcome: completed
---
`test/hub/fs.test.ts` › `skips what a caller's ignore rejects, such as git's
own directory` failed once in two `bun run check` runs on main `a1df35a`
(2026-10-21, load average ~8, other gates live): `(fail) fsSource.changes >
skips what a caller's ignore rejects, such as git's own directory
[1239.83ms]`. It passed in the rerun and in 3 of 3 isolated runs of the
file. That failure's message was not captured.

A likely cause, not proven: under load, FSEvents delivers the probe's or the
settling write's event more than 300 ms late. It then lands in the 500 ms
window that asserts the `.git` write fired nothing.

Build: first capture the failing assertion. Run the file with
`--rerun-each 50` while the machine is loaded, for example with a second
`bun run check` running. Then make the assertion insensitive to late events
from earlier writes, for example by checking which path fired, without
lengthening the windows. The sibling test `emits once per burst …` uses the
same arm-then-settle pattern, so check it too.

Done when: the cause is named, with the failing message as evidence, and
the reviewer sees `bun test test/hub/fs.test.ts --rerun-each 50` pass under
the same load.

## Comments

### @agent at 2026-10-21 18:13:45 +00:00

Done: Implemented task 1 in one commit: acbb6930e77b3a3a2fcc351aaee166c05ddeba01. Only test/hub/fs.test.ts changed. Both arm-then-settle tests now tap raw FileSystem watch paths and excuse an emission only when an earlier-write path arrived after the previous emission. Ignored writes must also be observed by the raw watch. No timing windows lengthened; no production or sandbox changes.

Cause evidence: sandbox guard covering the shared hub cache, already fixed by ea846d9 (todo-md:48), is the supported explanation rather than demonstrated FSEvents lateness. `git show a1df35a:test/sandbox.ts | grep -n 'guarded ='` returned `22:const guarded = [join(repo, "todo"), realHome]`; `git show --stat ea846d9` identifies the cache exclusion fix. Independently reproduced in a detached scratch worktree with that old guard and a scratch cache writer: `this test wrote outside its temporary directory ... ~ cache/list.json`; git-ignore test failed [1236.20ms], matching reported [1239.83ms]. Old guard: 4 pass / 2 fail; HEAD guard under identical writer: 6 pass / 0 fail. The original message remains unavailable, so I qualified the plan's categorical historical attribution. Main-checkout registry/list writes can still trip the guard by design; unchanged and no foreign task filed.

Test-first proof: injected probe.md write just before the git quiet window fails the original test with Expected false / Received true [724.32ms]; identical injection with hardened test passes 6/6. Injection removed. Mutation checks in scratch each failed as expected and were restored: dropped ignore [741.31ms], dropped debounce [316.09ms], dropped lock filter [1191.97ms]. These were intentional failures, not claimed unrelated/pre-existing failures.

Verification:
- `bun test test/hub/fs.test.ts --rerun-each 50`: 300 pass / 0 fail, 1100 assertions [137.25s]. Concurrent load: 10 CPU workers, 2 file-churn workers, three loops of the changed test file. Load averages before 7.90/14.96/18.77, after 22.79/17.30/19.07. Concurrent loops completed 158 runs with no failures. Reproduction script is verification.path/load.py; all workers joined before returning. This replaces the plan's wider test/hub loops to obey focused-test restrictions.
- `bun run lint`: exit 0.
- `bun run typecheck`: exit 0.
- Post-commit `bun test test/hub/fs.test.ts`: 6 pass / 0 fail, 22 assertions.
- `git diff --check` clean; committed tree clean.

Focused search: `rg -n 'watchList|fsSource.changes|takeWithin|eventually\(|liveTest' src test` (saved proof/focused-search.log). Local helpers only are added; shared test/hub/helpers.ts, Disk, eventually, takeWithin, liveTest and production values are unchanged. Focused tier is the changed test file. No full gate run: check stage owns it.

Evidence logs and load script: verification.path artifact, this attempt's proof/{red-late,ignore,debounce,lock,old-guard,head-guard,loaded-rerun,load-tests-*}.log. Read the prior plan and sampled its output.log for recorded reproduction/load evidence, then independently repeated the failure-class and mutation checks above. Scratch worktree removed. Shared install untouched. No subagent tool is available; the orchestrator's next review stage receives the commit and this evidence. Run branch/worktree retained for the orchestrator's integration.

Review: approved (4/5)
Approved. The diff from 92d3a8a is one commit, acbb693, and touches only test/hub/fs.test.ts (+97/-29). I read all of it.

Check: check.command is `bun run check`, and check#1 passed it at acbb693 (1433 tests). The Done-when names a different command, `bun test test/hub/fs.test.ts --rerun-each 50`. I ran that under load myself (below).

Done-when / required cases
- "Cause named, with the failing message as evidence": pushed back, accepted. The original a1df35a message was never captured. The implementer reproduced a failure with a1df35a's sandbox guard (`guarded = [join(repo, "todo"), realHome]`): `this test wrote outside its temporary directory … ~ cache/list.json` at 1236.20ms, against the reported 1239.83ms. The same writer under HEAD's guard (ea846d9, todo-md:48) passes 6/6. The commit message says the historical attribution is not certain. The logs are at proof/old-guard.log and proof/head-guard.log.
- "Reviewer sees `--rerun-each 50` pass under the same load": done, I observed it. My load was 6 CPU burners plus 2 loops of `bun test test/hub` from a HEAD scratch worktree. Script: <attempt>/proof/load.sh. Result: `300 pass / 0 fail / 1100 expect() calls [138.34s]`. Load averages were 8.64 before and 16.38 after. Log: proof/loaded-rerun.log.
- "Make the assertion insensitive to late events, without lengthening windows": done. `watching` taps raw `FileSystem.watch` paths, and `quiet` excuses an emission only when a raw path the window's own write doesn't claim arrived after the last emission. The windows are unchanged: 5 s, 500 ms, 300 ms settle, 200 ms probe.
- "Check the sibling `emits once per burst …`": done. It uses the same `arm` and `quiet` helpers.

Do the tests still catch the bugs? I checked by reversing assertions and mutating code in a scratch copy, removed afterwards:
- Without `Stream.debounce("100 millis")` in src/hub/sources/fs.ts, `emits once per burst` failed at line 163 (`expect(after).not.toMatchObject({ emitted: true, late: [] })`): 10/10 at idle and 30/30 at load ~17–18. Removing the debounce therefore still breaks the test, even with the looser excuse.
- With `expect(git.seen).toContain` reversed, the git test fails with `Received: [ ".git", ".git/refs", ".git/refs/heads", ".git/refs/heads/main" ]`. The tap really does see the ignored write.
- With `ignored.seen` reversed, the burst test fails at line 171. The raw tap sees both `.todo.lock` and `ignored.tmp`.
- The implementer's logs show the ignore and lock-filter mutations failing at line 191 [741ms] and line 172 [1192ms]. Their injected late probe fails the original test (Expected false / Received true) and passes the hardened one.

Class check on the `own` predicates:
- The `own` predicates match exact relative paths (`.todo.lock`, `ignored.tmp`) and `isGit` uses path segments. The raw paths the watcher reports are relative: `.git`, `.git/refs`, … above.
- On a platform whose watcher reports absolute or `./` paths, `own` would claim nothing. A lock-filter regression would then be excused rather than flagged. That is a weaker test, not a false failure, and it is moot on this darwin/FSEvents machine.
- I did not test Linux inotify paths because no such host is available.

Residual weakness (not blocking): any unclaimed raw event after the last emission excuses a second emission. A real late event in the same window could therefore mask a filter regression in that single run. That is inherent to the task's own design ("checking which path fired").

Implementer gaps
- Original message unrecorded: pushed back, accepted. The reproduced message stands in for it, and the commit message says so.
- Full gate and wider loops not run: done. check#1 ran the gate, and I ran the Done-when command under load.

Comments: I read the task file todo/read-cost/51-the-fs-watch-test-that-skips-git-s-directory-is-flaky-under.md (25 lines). `grep -nE "^#|omment"` printed nothing, so it has no Comments section. The brief has no pre-start comments. That makes 0 comments and no authors.

What to build: there are no numbered items. The Build paragraph's three asks (capture under load, path-aware assertion, check the sibling) are covered above.

Decisions: the brief has none.

Commits: acbb693 is the do commit. It follows the repo's conventional `test(hub): … (todo-md:51)` form, its author is Leza Lutonda, and it changes only the test file. No other orchestrator commits are on the branch.

Quantities in the commit message:
- 1236.20ms: matches proof/old-guard.log.
- "300 pass, 0 fail": the implementer's loaded run, and I re-observed it.
- "Dropping ignore, debounce, or lock filtering still fails": I re-observed debounce; ignore and lock are in their logs.

Lint: `bun run lint` exits 0 with no oxlint warnings (0 warnings). The base can be no lower than 0, so there is no increment. The test stays colocated in test/hub, it adds no module, and no spec or doc needs to change.

Observed outside the diff: one of my 48 load-loop runs of `bun test test/hub` failed `autoSync > syncs every syncable project one interval after startup` with `NotFound: FileSystem.makeTempDirectoryScoped`. That happened with two `test/hub` runs going at once. This diff does not touch that test, so it may be a separate flake worth a task.

