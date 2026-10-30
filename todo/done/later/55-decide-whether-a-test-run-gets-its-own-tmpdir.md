---
title: Decide whether a test run gets its own TMPDIR
tags: [test]
group: Later
completed_at: 2026-10-30T18:51:20Z
outcome: completed
---
todo-md:54 (`59f196f`, `d632075`) gave `test/sandbox.ts` a
`scratchDirectory(prefix)` helper. The preload's `afterAll` removes exactly
the paths it recorded, and every current `mkdtemp` site uses it. Its
reviewer's note (a) is still open: a future test that calls a raw
`mkdtemp`/`mkdtempSync` under `tmpdir()` and never removes the directory
leaks it, and no committed test fails. Nothing leaks today:
`TMPDIR=<empty> bun run check` on `fceb4e2` leaves that TMPDIR empty.

The person decides (it changes what every test and spawned process sees):

1. Leave it. `scratchDirectory` is the convention, and reviews catch a raw
   `mkdtemp`.
2. The preload points `TMPDIR` at a per-run scratch directory and removes
   it in `afterAll`, so anything a test or a child process leaves under
   `tmpdir()` goes with it. Check first that the git tests, the spawned
   `todo` processes and `bun test`'s own temp files are fine under a
   moved `TMPDIR`, and that two concurrent runs still each get their own.
3. A lint rule or a test that rejects a raw `mkdtemp` outside
   `test/sandbox.ts`.

Done when: the person has picked one. For 2 or 3, a test that a raw
`mkdtemp` left behind fails the run (or is removed), red before the change.
