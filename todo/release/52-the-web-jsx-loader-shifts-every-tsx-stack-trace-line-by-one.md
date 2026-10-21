---
title: The web JSX loader shifts every tsx stack-trace line by one
tags: [bug, web]
---
todo-md:49 (`388c7ce`) added `src/web/load.ts`, a runtime `Bun.plugin` whose
`onLoad` returns `` `/** @jsxImportSource remix/component */\n${text}` `` for
every `.tsx`. That added line shifts every line number in a `.tsx` stack trace
by one, under `todo web` from source, from any working directory, in our
files and in `@lemol/ui`'s. An error logged from a page, or a debugger
breakpoint set from such a trace, points at the line after the one that ran.

Evidence (2026-10-21, main `b8b3f13`, bun 1.4.3): a probe `thrower.tsx`
throws on line 2. Imported directly, the trace reads `thrower.tsx:2:13`.
Imported after the same plugin is registered, it reads `thrower.tsx:3:13`.

Build: keep the source's line numbers. One way is to put the pragma on the
file's first line with no newline (`/** @jsxImportSource remix/component */ `
followed by the text). Another is to leave alone a file that already names a
`jsxImportSource`: all of `src/web`'s JSX files carry one.
Whichever you choose, keep the plugin covering `@lemol/ui`'s pragma-less
`.tsx`, which is the reason it exists.

Tests first: in a test next to the web tests, load a `.tsx` that throws on a
known line through `src/web/load.ts`'s plugin. Assert the stack names that
line. Keep todo-md:49's "web from source renders the board outside the
repository" passing.

Done when: that test passes and fails with the newline restored. Out of
scope: the bundle (its `.tsx` are compiled at build time), and asking
`@lemol/ui` to ship pragmas (another repository).
