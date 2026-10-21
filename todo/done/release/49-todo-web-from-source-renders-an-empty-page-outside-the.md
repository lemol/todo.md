---
title: todo web from source renders an empty page outside the repository
tags: [bug, web]
group: Release
completed_at: 2026-10-21T17:32:16Z
outcome: completed
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

## Comments

### @nzila at 2026-10-21 17:32:16 +00:00

Done: Implemented todo-md:49 per plan (one task, one commit `1a050b3` on nzila/01M5FQ7YVQD0W3EWJ9TM5HE3SB).

What was built:
- `src/web/load.ts` (new): registers a runtime `Bun.plugin` (`todo-md-remix-jsx`) at module top level that prepends `/** @jsxImportSource remix/component */` to every `.tsx` onLoad with loader `tsx`, then exports `loadServer = () => import("./server.ts")`. Covers every `.tsx` (not just @lemol/ui's) per plan decision; repeat pragma on our own files is harmless.
- `src/cli/commands/web.ts`: lazy import now goes through `../../web/load.ts` (`loadServer`) instead of `../../web/server.ts`; help path still never loads web.
- `test/cli/web.test.ts`: new test spawns source `src/cli/bin.ts` with cwd in a tmpdir outside the repo (own HOME/TODO_MD_HOME) and asserts the board page contains "Ready task".
- Docs: one-two sentences each in `src/web/README.md` and `docs/architecture/tooling.md`.

Verification (each run separately, all to completion):
- New test before fix: 3 pass / 1 fail with `Received: "<!DOCTYPE html><!-- rmx:flush fragment -->"` (the 42-byte page) — this is the fail-with-fix-reverted evidence.
- After fix: `bun test test/cli/web.test.ts` → 4 pass, 0 fail.
- `bun run lint` → exit 0 (oxfmt check + oxlint clean).
- `bun run typecheck` → exit 0.
- `bun test test/cli/bundle.test.ts test/boundaries.test.ts test/web/server.test.ts` → 26 pass, 1 skip, 0 fail (bundle still serves, help skips web, web import graph holds).
- `bun run fix` → only the 5 intended files touched.
- Focused-test search `grep -rn "web/server" src test scripts docs/architecture` → only `test/web/server.test.ts:5` (direct server import in the in-process test, untouched).

Notes: no plan/code disagreement — followed the plan exactly. Whole-gate `bun run check` deliberately not run (plan forbids it; `check` stage owns it). Cause evidence (tsconfig lever, React-shaped nodes, preload probe) is from the plan stage, not re-probed here.

Review: approved (4/5)
Approved. Check passed: `bun run check` (brief check.command; Done-when names the web test, which I also ran).

Done-when: "test passes, fails with fix reverted" — pinned by test/cli/web.test.ts "web from source renders the board outside the repository" (spawns source bin.ts with cwd in a tmpdir, own HOME/TODO_MD_HOME, asserts the page contains "Ready task", not just 200). I ran it: 4 pass. Reversal in a detached scratch worktree (web.ts importing server.ts directly, load.ts unused): 3 pass / 1 fail at the final expect (toContain "Ready task") — scratch removed.

What to build: prove cause (plan stage: @lemol/ui pragma-less .tsx compiled with cwd tsconfig; corrects the task's hypothesis; not re-probed by me, the reversal result is consistent); source runs independent of cwd — src/web/load.ts Bun.plugin prepends the pragma, src/cli/commands/web.ts goes through loadServer; tsconfig.json untouched; bundle untouched. Docs updated in src/web/README.md and docs/architecture/tooling.md. Comments: none read (brief carries no pre-start comments; todo/TODO.md has none for this task) — no authors. Implementer gaps: only "whole gate not run", which check covers.

Minor, non-blocking notes: test hard-codes --port 49170 (could collide on a busy machine; port 0 or a free-port pick would be sturdier). The plugin applies to every .tsx, including our own that already carry the pragma (harmless, stated). tooling.md inserted sentence leaves one long line; oxfmt check passes.

Branch: nzila/01M5FQ7YVQD0W3EWJ9TM5HE3SB

nzila run 01M5FQ7YVQD0W3EWJ9TM5HE3SB
