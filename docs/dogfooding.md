# Dogfooding nzila on todo-md

nzila loops run this list. This file is their handoff: **Now** holds live
state and the next step, and **Runs** links one file per reviewed run. The
process is the `nzila-dogfood` skill in the nzila repository.

## Now

- **Loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (intensive, width 1):**
  - Round 1 ran 46 (`a1df35a`), which filed 48, 49, 50 and 51.
  - Round 2 ran 48 (`f454ec5`): reviewed, nothing filed. The gate no longer
    fails on another process's parse-cache writes.
  - Proposed **47** alone. With 48 landed, the cache key it changes no
    longer sits beside a guard that watches the cache. Nothing else is
    running.
- **Next:** after 47, run 49 and 51 (49 is web, 51 an fs watch test:
  disjoint, but the loop is width 1). 50 waits for the person.

## Runs

| Run | Landed | Follow-ups |
| --- | --- | --- |
| [48 The sandbox guard fails a test for another process's parse-cache write](dogfooding/runs/48-the-sandbox-guard-fails-a-test-for-another-process-s-parse.md) | `f454ec5` | none; ratings recorded |
| [46 Ship the todo CLI as a bundle](dogfooding/runs/46-ship-the-todo-cli-as-a-bundle.md) | `a1df35a` | 48, 49, 50, 51; ratings recorded |
