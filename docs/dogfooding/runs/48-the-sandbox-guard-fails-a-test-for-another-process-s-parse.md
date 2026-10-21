# 48 The sandbox guard fails a test for another process's parse-cache write

Run `01M5FN5A6TVZ68NN3DJJE7F67B`, loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (width
1). Landed `f454ec5`; the code is `ea846d9` (on the branch: `f464a94`).

## Attempts

- triage#1 rated it simple/low infrastructure and switched to reviewed.
- do#1 added a `skip` list to `snapshotOf` (top-level directories only) and
  made `guarded` `{dir, skip}` entries: the real home skips `["cache"]`,
  `todo/` skips nothing. Tests first in `test/sandbox.test.ts`.
- check#1 passed on `f464a94`.
- review#1 approved. It reversed the behavioral assertion in a scratch
  copy, ran the new tests against the base, and probed the skip across
  nested, renamed and differently cased entries.

## Controller review (intensive)

- Done when, both pinned in `test/sandbox.test.ts`:
  - cache skipped, registry still reported: `skipped directories are not
    reported, the files beside them still are`;
  - the guard's skip lists: `the real hub's cache is skipped and its
    registry is not`.
- Docs: the header comment of `test/sandbox.ts` says what is skipped and
  why.
- Out of scope held: `src/hub/Hub.ts` and `src/fs/parsing.ts` untouched.
- The pin test repeats Hub.ts's `"cache"` literal rather than deriving it.
  A rename would fail the guard loudly, never hide an escape, so no task.
- `~/.todo-md/projects/<name>/` is still watched; every project dir there
  is empty today, so no false positive is in evidence.
- On main `f454ec5`, `bun run check` passed: 1302 pass, 128 skip, 0 fail.
- Doc drift fixed: task 47 said the sandbox guard relies on the cache file
  name; it no longer watches `cache/`.
- Filed nothing. No test files added, moved or deleted; this repository
  has no `test/timings.json`.
- Friction for nzila (not filed here): the skill's `review.ts` and
  `rating.ts` call `bin.ts show` under the current repository's root, so in
  todo-md they run the todo CLI and crash; `rating.ts` works run from the
  nzila checkout.
