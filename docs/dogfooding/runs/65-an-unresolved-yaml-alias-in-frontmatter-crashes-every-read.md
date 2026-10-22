# 65 An unresolved YAML alias in frontmatter crashes every read

Run `01M5GTG9BEZNWKKCKHYYGP6WRC`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `318d1ca`. The code is `0ed9736`, `4ac9291`, `47bd297` and
`7939b68` (the run's `9b5c5d4`, `48f171a`, `a65fce5`, `265fc5b`).

## Attempts

- triage#1 (cc_sonnet_m) routed to the planned flow.
- plan#1 (cc_opus_hg): catch `toJS()` in `readFrontmatter`; in the writer,
  splice requested keys of a block map whose aliases do not resolve.
- do#1 (pi_sol_m) built the plan with the brief's tests. check#1 passed.
- review#1 (cc_opus_md), changes: F1, a flow map with an unresolved alias
  took the whole-rebuild fallback and lost its keys.
- do#2 (oc_go_spark_m) returned no edits for that case, but the guard also
  caught ordinary non-mapping frontmatter (`- a\n- b`).
- review#2 (cc_opus_m), changes: F2, that regression. review-fix#1
  narrowed the guard to errors other than `notMapping`.
- review#3 (pi_sol_m) approved, with reversals in a scratch worktree and
  class probes over flow, sequence, scalar, nested, key and merge aliases.
  One citation does not open (`fs/parsing.ts:216-225`, the file is
  `src/fs/parsing.ts`).

## Controller review (intensive)

- Tests first, each pinned:
  - `parseTaskFile` on `x: *a`: `test/markdown/taskFile.test.ts`
    "frontmatter aliases > an alias to a missing anchor is invalid
    frontmatter".
  - `parseTodoFile`: `test/markdown/todoFile.test.ts` "reports an alias to
    a missing anchor and keeps the defaults".
  - `updateTaskFile`: taskFile.test.ts "an edit splices only the changed
    key".
  - The resolving anchor: taskFile.test.ts "an alias to an anchor that
    exists still reads", and the reader test in `frontmatter.test.ts`.
  - Done when: `test/cli/query.test.ts` "reports a task file whose
    frontmatter alias does not resolve". My CLI probe agrees: `list`,
    `check` and `show` work; `check` exits 1 naming the file.
- What to build 1 to 3: done (the catch, the writer and README, parser
  version kept at 4: a throw was never cached). Comments: none before the
  run; the only one is nzila's closing comment.
- **Found (filed 66):** for frontmatter the writer leaves as it is (a flow
  map with an unresolved alias), `todo edit` prints `Updated`, `done`
  prints `Done` and `cancel` prints `Cancelled`, all exit 0, and nothing
  is written. The done file has no `completed_at` or `group`, the
  cancelled one no `outcome` or reason, and `reopen` loses the group. The
  older syntax-error fallback (since `03df9fa`) deletes `title` and every
  other line on an edit. The brief allowed "leave the frontmatter as it
  is", so this is the brief's gap as much as the reviews'.
- **Found (filed 67):** the brief's out-of-scope line was wrong:
  `src/hub/registry.ts` `entries` calls `pair.value.toJS(doc)`. With
  `projects:\n  p: *a` in `projects.yaml`, `todo --dir <list> list` exits
  1 with an uncaught `ReferenceError`.
- No timings regeneration: test files were modified, and none were added,
  moved or deleted.
