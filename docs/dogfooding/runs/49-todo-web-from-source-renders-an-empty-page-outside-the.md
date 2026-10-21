# 49 todo web from source renders an empty page outside the repository

Run `01M5FQ7YVQD0W3EWJ9TM5HE3SB`, loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (width
1). Landed `b8b3f13`; the code is `388c7ce`.

## Attempts

- triage#1 assessed it moderate/low (web-frontend, infrastructure), in
  7m41s.
- plan#1 proved the cause and corrected the task: the pragma-less `.tsx`
  are `@lemol/ui`'s. Bun ignores that package's `tsconfig.json` in the bun
  store, so those files take the working directory's, which outside this
  repository means React JSX. `--tsconfig-override` and a `--preload`
  plugin each restored the board.
- do#1 added `src/web/load.ts`, a runtime `Bun.plugin` that prepends
  `/** @jsxImportSource remix/component */` to every `.tsx`. `todo web`
  now loads the server through it. A spawned source CLI in a tmpdir pins
  the fix by asserting the board contains "Ready task".
- check#1 passed. review#1 approved after a scratch reversal (3 pass,
  1 fail).

## Controller review (intensive)

- Done when: "web from source renders the board outside the repository"
  in `test/cli/web.test.ts`. It fails at `toContain("Ready task")` with
  the fix reverted (review#1's scratch run, in its log). It passed
  `--rerun-each 10` here: 40 pass. `bun run check` on main `b8b3f13`:
  1305 pass, 128 skip, 0 fail.
- Constraints held: `tsconfig.json` is untouched, the bundle test passes in
  the gate, and the help path still never loads web.
- Class check on the plugin:
  - Line numbers: the prepended `\n` shifts every `.tsx` stack-trace line
    by one. In a probe, `thrower.tsx:2:13` direct became `thrower.tsx:3:13`
    under the plugin. Filed as **52**.
  - Which files: `@lemol/ui` ships no `.jsx`. In `src/web`,
    `app/ui/markdown.tsx` and `app/ui/groups.tsx` have no pragma, but they
    contain no JSX (only HTML in template strings). So plan#1's claim that
    every `src/web` `.tsx` carries the pragma is wrong, but it does no harm.
  - Other entries: `test/web/server.test.ts` imports `server.ts` directly,
    from the repository's tsconfig, which is fine. No other caller.
- review#1's port note is moot: `--port` falls back to the next free port,
  and the test reads the URL from stdout.
- Fixed here: the `docs/architecture/tooling.md` line that do#1 left
  unwrapped.
- Comments: one, by @nzila (the closing note). No test files were added,
  moved or deleted, and this repository has no `test/timings.json`.
- Not filed here:
  - For `@lemol/ui`: ship the `jsxImportSource` pragma in its `.tsx`, so
    consumers need no loader.
  - For nzila:
    - `digest.ts` crashes on a `message.content` that is a string.
    - `review.ts` and `rating.ts` only work when run from nzila's checkout.
    - review#1 put its scratch worktree inside the run's worktree.
