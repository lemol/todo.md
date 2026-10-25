# 52 The web JSX loader shifts every tsx stack-trace line by one

Run `01M5FTWT1WZANJ294VC9CB051F`, loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (width
1). Landed `3cfa7b2`. The code is `22f81b2`.

## Attempts

- triage#1 routed it to the reviewed flow, which fits a one-line fix.
- do#1 took the brief's first option. `src/web/load.ts` now follows the
  pragma with a space, not `\n`. It added `test/web/load.test.ts` and ran it
  red first (`thrower.tsx:3:25`). It said it had not re-run the test with
  the newline restored.
- check#1 passed (1434 tests).
- review#1 approved. It closed do's gap by restoring the newline in a
  scratch worktree, and the test failed. It proved its absence search
  (`component */\n`) against the base. It also tried a BOM, a file that
  already has the pragma, a `"use client"` file and an error on line 1. It
  noted that columns on line 1 now shift by the 41-character prefix.

## Controller review (intensive)

- Done when:
  - The test passes: `bun test test/web/load.test.ts` on `3cfa7b2` gives
    1 pass.
  - The test fails with the newline restored. A probe in the attempt
    directory registered the same plugin with each separator. It printed
    `thrower.tsx:3:25` with `\n` and `thrower.tsx:2:25` with a space.
  - Run 49's "web from source renders the board outside the repository"
    still passes. It is in check#1's 1434 tests.
- The plugin still covers `@lemol/ui`'s `.tsx` files that have no pragma:
  the filter is still `/\.tsx$/`, and the plugin still prepends to every
  file.
- Not filed:
  - The test leaves its `mkdtemp` directory behind, as other web tests do.
  - Importing `load.ts` registers the plugin for the rest of the test
    process. That is harmless: a second pragma is a no-op, and
    `tsconfig.json` already sets `jsxImportSource` for this repository's
    files.
- Orchestrator friction (its task, not this list's): the review's
  closing block listed `.../thrower.tsx:3` as a "citation that does not
  open". That was a quoted stack frame from a test run, not a citation.
- No timings regeneration: this repository has no `test/timings.json`.
- No follow-ups.
