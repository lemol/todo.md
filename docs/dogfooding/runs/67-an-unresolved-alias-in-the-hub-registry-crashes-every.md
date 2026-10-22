# 67 An unresolved alias in the hub registry crashes every command

Run `01M5GWF9M08NKXCFY84GVQ70KY`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `6c99e59`. The code is `c56c25b` and `668b9b8`.

## Attempts

- triage#1 (oc_go_spark_xh) routed to the planned flow.
- plan#1 (cx_sol_m): one `Effect.try` in `read` around `parseDocument`, a
  whole-document `toJS` check and the per-entry conversion; `write` wraps
  `doc.toString()` the same way.
- do#1 (agy_sonnet55) built it with every brief test plus a write test
  (deleting an anchor another entry aliases refuses the write). check#1
  passed.
- review#1 (cc_opus_md), changes: R1, the plain `doc.toJS()` made Node
  print "Keys with collection values will be stringified" for a
  collection key.
- do#2 (cc_sonnet_m) switched to `toJS({ mapAsMap: true })`, with a test
  that fails on the old call. check#2 passed.
- review#2 (oc_go_spark_xh) approved, with reversals on the base and 15
  class probes (merge keys, tags, two documents, self-reference, …).

## Controller review (intensive)

- Tests first, each pinned in `test/hub/registry.test.ts` unless named:
  - unresolved alias and alias bomb: "alias failures > entries fail with
    a RegistryError: …" (exact message, `RegistryError`), and "update
    refuses without calling edit: …" (file unchanged).
  - resolving alias reused by two projects: "resolving aliases reused by
    two projects still read".
  - CLI: `test/cli/bin.test.ts` "a bad registry is one error line, and
    --dir does not need it" (exact `{code, stdout, stderr}`).
- Reversal (scratch copy): with `doc.toJS({ mapAsMap: true })` removed,
  the two `unused: *a` cases fail (18 pass, 2 fail); the alias outside
  `projects` is what only the whole-document check catches.
- What to build: 1 done (`read`); 2 done, with the choice stated:
  `--dir` does not need the registry. `resolveProject` already had
  `Effect.orElseSucceed`; a typed `RegistryError` is what lets it work.
- Comments: none before the run; the only one is nzila's closing comment.
- Probes at `6c99e59` (own `HOME`): `--json projects ls` gives one JSON
  error line; `--dir a list` exits 0; `projects add` on a bad registry
  refuses and leaves the file; `projects rm p` with `q: *b` aliasing
  `p`'s anchor refuses and leaves the file.
- **Found (filed 68):** `projects: *x` (an alias to a map that resolves)
  reads as `projects must be a map`, against the README's new "a
  resolving alias is fine"; and `rm`'s refusal blames the file rather
  than the edit. Both pre-date the check but 67's README made the first
  claim. review#2 did not try an aliased `projects` key.
- No timings regeneration: test files were modified, none added, moved
  or deleted.
