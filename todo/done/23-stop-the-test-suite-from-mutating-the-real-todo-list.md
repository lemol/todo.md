---
title: Stop the test suite from mutating the real todo list
completed_at: 2026-09-19T04:30:59Z
outcome: completed
---
`bun test` can complete real tasks in this repository's own `todo/` list. One
full-suite run on 2026-09-18 marked tasks 19, 20 and 09 done and moved their
files into `todo/done/`; the backlog was restored from HEAD. A test that can
reach the real list can also reach any other registered project.

It is rare. Fourteen consecutive full-suite runs afterwards came back clean,
and running `test/cli`, `test/hub`, `test/fs`, `test/core` and `test/web` one
directory at a time never reproduced it, so it needs the whole suite and is
probably order-dependent.

The flaky `dashboard > describes each project once and keeps overview rows
aligned` case in `test/hub/Hub.test.ts` — an `ahead` count of 1 where 2 was
expected, passing in isolation — looks like the same leak surfacing.

## Suspects

- `test/cli/bin.test.ts` spawns the real binary with `env: { ...process.env }`
  and no `TODO_MD_HOME`, so that subprocess reads the real `~/.todo-md`
  registry, where this repository is registered as project `todo-md`.
- `test/web/harness.ts` passes `cwd: process.cwd()` into `createAppRouter`,
  and the projects controller resolves a relative target against it.

## What to do

- Give every test an isolated `TODO_MD_HOME` and `cwd`, spawned subprocesses
  included, so no test can resolve a registered project.
- Make the escape loud rather than silent: fail when a test resolves a list
  outside its temporary directory.
- Confirm the dashboard case is no longer flaky by running the full suite
  repeatedly, not the file alone.

## Comments

### @leza.lutonda at 2026-09-19 04:30:55 +00:00

Closed by isolating the suite and adding a tripwire.

- `test/sandbox.ts`, preloaded via `bunfig.toml`, gives the run an empty
  `$TODO_MD_HOME` (inherited by anything it spawns) and snapshots this
  repository's `todo/` list and the machine's real hub home. An `afterEach`
  compares them and fails the test that wrote outside its temporary
  directory, naming the paths it changed.
- `test/cli/bin.test.ts` spawned the binary with the machine's environment:
  `todo projects` in that subprocess listed all five real projects,
  `todo-md` among them. It now passes `HOME` and `TODO_MD_HOME` under its own
  temporary directory, with a test asserting the registry is empty.
- `test/web/harness.ts` passed `process.cwd()` as the router's `cwd`, so a
  relative project target resolved inside this repository. It now takes a
  `cwd` option defaulting to the hub's temporary home, with a test asserting
  a relative target lands under it.

Two corrections to this task's notes:

- The flaky `dashboard > describes each project once` case is not this leak.
  `dashboardOf` describes projects with `{ concurrency: 4 }`, and `statusOf`
  awaits `readState` (a real file read) before calling `source.status`, so
  which project increments the shared counter first is not fixed. A probe
  running 400 dashboards swapped the order 11 times — about the rate that
  gives one failure in fifteen full-suite runs. The test now counts reads per
  project instead of assigning a global sequence number, which is what it
  meant to assert: each project described exactly once.
- The route that completed 19, 20 and 09 on 2026-09-18 was never reproduced,
  so it is not proven to be either suspect. Both were real ways to reach the
  registry and this repository's list, and are closed; the tripwire is there
  because that argument is not a proof. If it ever happens again the suite
  will fail and name the test.

Verified: `bun run check` green, and 20 consecutive full-suite runs with the
tripwire armed left `todo/` unchanged.
