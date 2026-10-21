---
title: todo web from source renders an empty page outside the repository
tags: [bug, web]
---
Run from source with a working directory outside this repository,
`todo web` serves a 42-byte page: `<!DOCTYPE html><!-- rmx:flush fragment -->`.
The same list served from the repository root, or from the bundle, renders
the board (49461 bytes).

Evidence (2026-10-21, main `a1df35a`, scratch fixture with its own
`TODO_MD_HOME`, one `Ready task`):

- `cd <fixture> && bun <repo>/src/cli/bin.ts web`: GET `/p/fx` returns 42
  bytes, twice.
- `cd <repo> && bun src/cli/bin.ts web --dir <fixture>/todo`: 49461 bytes.
- `<fixture-dist>/bin.js web` (todo-md:46's bundle) from the fixture:
  49461 bytes.

todo-md:46's review#2 saw the same 42 bytes and left it as an observation.
The likely cause, not yet proven: Bun takes JSX settings from the
`tsconfig.json` nearest the working directory, and only this repository's
sets `jsxImportSource: remix/component`, so the `.tsx` under `src/web` is
compiled for another runtime. The workspace `todo` script and the shell
alias both run `src/cli/bin.ts` from other directories, so this is the
common path.

Build: prove the cause first (for example, set `jsxImportSource` through a
`/** @jsxImportSource remix/component */` pragma in one `.tsx` and probe
again). Then make source runs independent of the working directory, keeping
`tsconfig.json` as it is for the editor and typecheck.

Tests first: a test in `test/cli/web.test.ts` spawns the source CLI with a
working directory outside the repository and asserts the board page
contains the fixture's task title, not only a 200.

Done when: that test passes and fails with the fix reverted. Out of scope:
the bundle, which already renders.
