# Dogfooding nzila on todo-md

nzila loops run this list. This file is their handoff: **Now** holds live
state and the next step, and **Runs** links one file per reviewed run. The
process is the `nzila-dogfood` skill in the nzila repository.

## Now

- **Loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (intensive, width 1): stopped.**
  - Round 1 ran 46 (`a1df35a`), which filed 48, 49, 50 and 51.
  - Rounds 2 to 8 ran 48 (`f454ec5`), 47 (`33e317e`), 49 (`b8b3f13`), 51
    (`5542b21`), 52 (`3cfa7b2`), 53 (`67e4a6b`) and 54 (`fceb4e2`), all
    reviewed. The 54 review filed nothing.
  - Stopped after 54: the only open task is 50, and it waits for the
    person.
  - Closed (todo-md:n14): the closing audit rated 46's two reviews
    (pi_sol_m 5, cc_opus_m 4). No loop member was reviewed by a profile
    the stats call stale, so the sample took the fewest-rated ones.
- **Next:** the person decides 50 (installed bin) and 55 (54's note (a):
  a per-run `TMPDIR` or a lint, so a raw `mkdtemp` can't leak).

## Runs

| Run | Landed | Follow-ups |
| --- | --- | --- |
| [54 A test run leaves its temporary directories behind](dogfooding/runs/54-a-test-run-leaves-its-temporary-directories-behind.md) | `fceb4e2` | 55 (filed at the close); ratings recorded |
| [53 A hub test's temporary list vanishes under concurrent test runs](dogfooding/runs/53-a-hub-test-s-temporary-list-vanishes-under-concurrent-test.md) | `67e4a6b` | 54; ratings recorded |
| [52 The web JSX loader shifts every tsx stack-trace line by one](dogfooding/runs/52-the-web-jsx-loader-shifts-every-tsx-stack-trace-line-by-one.md) | `3cfa7b2` | none; ratings recorded |
| [51 The fs watch test that skips git's directory is flaky under load](dogfooding/runs/51-the-fs-watch-test-that-skips-git-s-directory-is-flaky-under.md) | `5542b21` | 53; ratings recorded |
| [49 todo web from source renders an empty page outside the repository](dogfooding/runs/49-todo-web-from-source-renders-an-empty-page-outside-the.md) | `b8b3f13` | 52; ratings recorded |
| [47 Hash parse-cache keys with Bun.hash](dogfooding/runs/47-hash-parse-cache-keys-with-bun-hash.md) | `33e317e` | none; ratings recorded |
| [48 The sandbox guard fails a test for another process's parse-cache write](dogfooding/runs/48-the-sandbox-guard-fails-a-test-for-another-process-s-parse.md) | `f454ec5` | none; ratings recorded |
| [46 Ship the todo CLI as a bundle](dogfooding/runs/46-ship-the-todo-cli-as-a-bundle.md) | `a1df35a` | 48, 49, 50, 51; ratings recorded |
