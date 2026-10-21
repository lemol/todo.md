# Dogfooding nzila on todo-md

nzila loops run this list. This file is their handoff: **Now** holds live
state and the next step, and **Runs** links one file per reviewed run. The
process is the `nzila-dogfood` skill in the nzila repository.

## Now

- **Loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (intensive, width 1):**
  - Round 1 ran 46, which landed `a1df35a` and was reviewed.
  - Filed:
    - 48: the sandbox guard counts cache writes;
    - 49: source `todo web` renders an empty page outside the repository;
    - 50: the installed bin's `dist/` goes stale or missing (needs the
      person's choice);
    - 51: the fs watch test is flaky under load.
  - Proposed **48** alone. It fixes a gate false positive that hits any run
    while other `todo` processes are live.
  - 47 is also ready. It changes the cache key that the guard's cache
    handling sits beside, so it waits a round rather than pairing with 48.
- **Next:** after 48, run 47, then 49 and 51. 50 waits for the person.

## Runs

| Run | Landed | Follow-ups |
| --- | --- | --- |
| [46 Ship the todo CLI as a bundle](dogfooding/runs/46-ship-the-todo-cli-as-a-bundle.md) | `a1df35a` | 48, 49, 50, 51; ratings recorded |
