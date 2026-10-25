# 68 An aliased projects map in the hub registry is refused as not a map

Run `01M5GZE6PN6VFAAV539B369V8D`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `95e9c79`. The code is `8835633`.

## Attempts

- triage#1 (oc_go_spark_xh): simple/low, so the reviewed flow.
- do#1 (cc_sonnet_m) chose to refuse an aliased `projects` ("projects
  must be a map, not an alias"). `write` now maps a `toString` "Unresolved
  alias" failure to "the edit would leave alias *b unresolved". It also
  updated the README bullet. Its stated gap: it did not watch the tests
  fail first. check#1 passed.
- review#1 (cc_opus_md) approved. It ran a reversal (3 fail) and CLI
  probes over map, null and sequence anchors, dotted and nested anchors,
  and `rm`/`rename`.

## Controller review (intensive)

- Tests first, both in `test/hub/registry.test.ts`:
  - the aliased map: a new row in the "alias failures" table, which runs
    "entries fail with a RegistryError: all: &x {p: {source:" and "update
    refuses without calling edit: …" (exact message);
  - anchor delete: "deleting an anchor still used by another project
    refuses the write" asserts the new message, and still asserts that the
    file is unchanged.
- Reversal (scratch copy, `isAlias` branch removed): 20 pass, 2 fail. The
  two table tests fail. This settles do#1's gap.
- What to build: 1 done, refuse (`read`); 2 done (README); 3 done
  (`write`'s catch). `update` reads before it edits, so `read`'s
  whole-document `toJS` holds up the premise in the catch's comment.
- Comments: none before the run; the only one is the orchestrator's closing comment.
- Class probes at `95e9c79` (own `HOME`):
  - an alias as an entry's key (`*k : {…}`) lists as a broken entry named
    `*k`. That is consistent with "a key that is not a valid name";
  - `rm p` where `&k p:` is the key's anchor and `other: *k` uses it
    refuses with "…alias *k unresolved" and leaves the file unchanged;
  - `rename p r` on that anchored key passes, and so changes what
    `other: *k` resolves to. That is an edge case outside `projects` and
    is not filed;
  - a `<<` merge key lists as a broken entry, since YAML 1.2 has no merge
    keys.
- **Found (filed 70):** `rm b` rewrites the untouched entry `a`, a flow
  map over 80 columns, into five lines. review#1 saw only the padding
  half and called it minor.
- **Found (filed 71):** `projects: !!map *x` prints
  `…at line 1, column 17:`. A registry syntax error ends at a colon, the
  same flaw as 69 has in frontmatter, and 69 rules the registry out.
- Nit, not filed: the README bullet's "the message names the file and the
  error's first line" now follows the `projects: *x` clause.
- No timings regeneration: one test file modified, none added, moved or
  deleted.
