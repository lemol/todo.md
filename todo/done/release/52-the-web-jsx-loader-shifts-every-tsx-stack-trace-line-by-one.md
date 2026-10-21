---
title: The web JSX loader shifts every tsx stack-trace line by one
tags: [bug, web]
group: Release
completed_at: 2026-10-21T18:20:43Z
outcome: completed
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

## Comments

### @nzila at 2026-10-21 18:20:43 +00:00

Done: Fixed todo-md:52: src/web/load.ts now puts the jsxImportSource pragma on the file's first line with a space instead of a newline, so line numbers are unchanged. The plugin still covers pragma-less .tsx files.

Test: test/web/load.test.ts registers the plugin by importing src/web/load.ts. It writes a pragma-less thrower.tsx in a temp dir that creates an Error on line 2, imports it, and asserts the stack contains `thrower.tsx:2:`.
- Before the fix it failed with `thrower.tsx:3:25`.
- After the fix it passes.
- I did not separately re-run the test with the newline restored, but the pre-fix failure is that same code.

Also run:
- test/cli/web.test.ts (includes "web from source renders the board outside the repository"): passes.
- test/web/server.test.ts: passes.
- `bun run lint`: clean after `bun run fix` reformatted the new test.
- `bun run typecheck`: clean.
- I did not run `bun run check`; the check stage owns it.
- I did not search src/ and test/ for values the change alters, because it changes no literal list, count or command name.

Review: approved (5/5)
Approved. Diff from the base c4bc18c to 28b61cc is one commit with two files: `src/web/load.ts` (pragma followed by a space instead of `\n`, plus a one-line comment) and the new `test/web/load.test.ts`.

Build items:
- Keep the source's line numbers: done. `src/web/load.ts:7` reads `` contents: `/** @jsxImportSource remix/component */ ${await Bun.file(path).text()}` ``. This is the brief's first option.
- Keep the plugin covering `@lemol/ui`'s pragma-less `.tsx`: done. The filter is still `/\.tsx$/` and the plugin still prepends the pragma to every file. Pinned by test/cli/web.test.ts "web from source renders the board outside the repository", which I ran and which passes.

Tests and Done when:
- The test loads a `.tsx` that throws on a known line through the plugin and asserts that line. Pinned by test/web/load.test.ts "the JSX loader keeps the source's line numbers in stack traces". The test is next to the web tests in test/web.
- What would make it fail: a stack that does not contain `thrower.tsx:2:`. The fixture has two lines and builds the Error on line 2, so the expected number comes from the fixture, not from the code.
- "Fails with the newline restored": I reversed it myself. In a scratch worktree (.nzila-scratch-$NZILA_ATTEMPT, since removed) I put `\n` back in load.ts and ran `bun test test/web/load.test.ts`. Result: `(fail) ... Expected to contain: "thrower.tsx:2:" Received: "Error: boom\n at .../thrower.tsx:3:25"`, 0 pass, 1 fail. This closes the gap do#1 stated, that it had not re-run the test with the newline restored.
- "Keep todo-md:49's test passing": `bun test test/web/load.test.ts test/cli/web.test.ts test/web/server.test.ts` gave 9 pass, 0 fail.

Comments: I read the task file `todo/release/52-the-web-jsx-loader-shifts-every-tsx-stack-trace-line-by-one.md` at review time. It has no Comments section, and the brief has no pre-start comments. That is 0 comments and 0 authors.

Implementer's stated gaps:
- No re-run with the newline restored: now done by my scratch reversal above.
- Did not run `bun run check`: the check stage did. check#1 ran `bun run check` (the brief's check.command) on 28b61cc and passed with 1434 tests across 106 files.
- Did not search for altered values: pushed back, it does not matter here, because the change alters no literal. I searched anyway with `rg -n -F 'component */\n' .` (excluding node_modules). It hits only the task file's own description, which is dated history describing the bug. Proof the search works: run on the base `git show c4bc18c:src/web/load.ts` it finds line 6, the old `contents:` line.
- Docs: src/web/README.md:57 and docs/architecture/tooling.md:76 describe load.ts registering the JSX loader. They do not mention a newline and remain accurate.

nzila's own commits: none on this branch; the only one is the implementer's fix commit 28b61cc. Decisions: none in the brief.

Class check (probe outside the repo, importing the plugin; each line shows file and stack frame):
- A file with a UTF-8 BOM: `bom.tsx:2:25`. Line correct, so the BOM does not break parsing.
- A file that already has the pragma and JSX: `pragma.tsx:3:25`, and the JSX evaluates to an object. The doubled pragma is harmless.
- A `"use client"` directive file with JSX: `dir.tsx:3:25`, object.
- Error on line 1: `l1.tsx:1:65`. Line correct.
- Not tried: a shebang. A `.tsx` with a shebang was already broken under the old prefix too, and no .tsx in the tree has one.

Non-blocking notes:
- Columns on line 1 now shift by 41 characters, the length of the prefix (`l1.tsx:1:65`). The task asks only for line numbers, and every src/web file has its own pragma on line 1.
- The test does not remove its mkdtemp directory. Other web tests, such as dashboard.test.ts, don't either.

Lint: oxlint reports `Found 0 warnings and 0 errors.`; the base had 0. oxfmt check is clean.

Scale cost: none. The change is one string per file load.

New config, command, event or intent: none. New directories: none; the new test file is colocated in test/web.


Citations that do not open (the verdict stands; a finding may still be right):
- `.../thrower.tsx:3` path does not exist
Branch: nzila/01M5FTWT1WZANJ294VC9CB051F

nzila run 01M5FTWT1WZANJ294VC9CB051F
