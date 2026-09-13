---
title: Build a TUI over the hub
tags: [tui, hub]
depends_on: [15]
---
## Goal

A terminal UI for the same things the web app does (dashboard across
projects, a project's board, task detail, done, check, sync), with no logic
of its own: everything comes from the hub.

Design context: [hub design §6, TUI](../../docs/superpowers/specs/2026-09-13-hub-design.md#tui).

## Before building

This task needs its own brainstorm and design spec. Decide there:

- **Library.** Evaluate TUI libraries that run on Bun (for example
  OpenTUI, Ink) against: works under Bun 1.4, keyboard-first, redraws on
  external events, testable without a real terminal.
- **Packaging.** Likely `apps/tui`, a private workspace member like
  `apps/web`, unless it should ship in the published package as `todo tui`
  (compare with task 11's `todo web`).
- **Scope of edits** for the first version (read and complete/reopen/comment
  at least; add and edit forms are harder in a terminal).

## Constraints the design must keep

- Uses only `@lemol/todo-md/hub` and `core`'s types, like the web app
  after tasks 17 and 18. No store building, no watching of its own.
- Live updates from `hub.changes`; `autoSync` optional.
- Capabilities drive what's offered (spec §1.5).
- A boundaries rule for the new app, like the web app's.

## Done when

- A design spec exists and this task is split into implementation tasks.
