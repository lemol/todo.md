# Dogfooding nzila on todo-md

nzila loops run this list. This file is their handoff: **Now** holds live
state and the next step, and **Runs** links one file per reviewed run. The
process is the `nzila-dogfood` skill in the nzila repository.

## Now

- **Loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (intensive, width 1):**
  - Round 1 ran 46 (`a1df35a`), which filed 48, 49, 50 and 51.
  - Rounds 2 to 5 ran 48 (`f454ec5`), 47 (`33e317e`), 49 (`b8b3f13`) and 51
    (`5542b21`), all reviewed. The 49 review filed 52 and the 51 review
    filed 53.
  - Proposed **52** alone (`src/web/load.ts`). Nothing else is running, so it
    shares no instruction text, no `src/runner/git/ops.ts` and no task id
    with a live run.
- **Next:** after 52, run 53 (hub test temp-dir flake, `test/`). 50 waits for
  the person.

## Runs

| Run | Landed | Follow-ups |
| --- | --- | --- |
| [51 The fs watch test that skips git's directory is flaky under load](dogfooding/runs/51-the-fs-watch-test-that-skips-git-s-directory-is-flaky-under.md) | `5542b21` | 53; ratings recorded |
| [49 todo web from source renders an empty page outside the repository](dogfooding/runs/49-todo-web-from-source-renders-an-empty-page-outside-the.md) | `b8b3f13` | 52; ratings recorded |
| [47 Hash parse-cache keys with Bun.hash](dogfooding/runs/47-hash-parse-cache-keys-with-bun-hash.md) | `33e317e` | none; ratings recorded |
| [48 The sandbox guard fails a test for another process's parse-cache write](dogfooding/runs/48-the-sandbox-guard-fails-a-test-for-another-process-s-parse.md) | `f454ec5` | none; ratings recorded |
| [46 Ship the todo CLI as a bundle](dogfooding/runs/46-ship-the-todo-cli-as-a-bundle.md) | `a1df35a` | 48, 49, 50, 51; ratings recorded |
