---
title: Stop the test suite from mutating the real todo list
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
