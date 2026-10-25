# 47 Hash parse-cache keys with Bun.hash

Run `01M5FNPM0NYA62PTHW6JQNXVGM`, loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (width
1). Landed `33e317e`; the code is `c785d6f` and `6c1239e`.

## Attempts

- triage#1 assessed it; plan#1 wrote a one-commit plan with a cold
  `keyOf` bench and a cyrb53 baseline.
- do#1 made `keyOf` `<path>:<length>:<Bun.hash base36>`, exported it, kept
  cyrb53 for the cache file name, and pinned the name, the key and the
  old-key miss in `test/fs/parsing.test.ts`.
- check#1 passed. review#1 asked for changes: `fs` now touches a Bun API,
  against `docs/architecture/README.md`'s rule that only composition roots
  do.
- do#2 recorded the exception in that rule. check#2 waited 6 minutes for
  the machine gate slot, held by another project's land, then passed.
- review#2 approved: re-measured, reversed each pin in a scratch worktree.

## Controller review (intensive)

- Done when:
  - `keyOf` under 3 ms cold: not a unit test (a wall clock). Measured
    here over another project's list, 3 cold runs: `files=596 chars=4697597`,
    1.32, 1.15, 1.12 ms.
  - `todo list` unchanged: review#2's byte comparison of 606 lines, base
    against head on a miss and on a hit.
  - `bun run check`: passed on main `33e317e`, 1304 pass, 128 skip, 0 fail.
- Constraints held: cyrb53 still names the cache file (pinned,
  `cache/1zxjo77c9fm.json`); `taskFileParserVersion` unchanged.
- Class check on the key: `Bun.hash` hashes a string's UTF-8 bytes, so
  `"\uD800"` and `"\uD801"` hash alike (probe: both `19l4l3rpu9dez`), and
  Latin-1 and UTF-16 strings of the same text agree. Two lone-surrogate
  texts of equal length at one path would share a key. Unreachable: both
  `parser.taskFile` callers in `src/fs/snapshot.ts` pass texts decoded
  from disk, which hold no lone surrogates. No task.
- The first `expect` in the `keyOf` test is tautological; the literal pin
  after it carries the test. No task.
- Comments: one, by the orchestrator (the closing note). Filed nothing. No
  test files added, moved or deleted.
- Friction for the orchestrator (not filed here): the brief names its
  dogfooding skill's `scripts/review-lock` as a path in this repository,
  where it does not exist; it lives in the orchestrator's checkout, and
  `review.ts` and `rating.ts` only work run from there (as in 48).
