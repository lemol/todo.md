# 69 A frontmatter syntax error names the YAML line and ends at a colon

Run `01M5GZZW777W18V0ZKZRXVK5YB`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `7a9dc10`. The code is `d3db970`.

## Attempts

- triage#1 (cc_sonnet_m) assessed it; plan#1 (cx_sol_m) chose to keep the
  position in the message, as `yaml`'s `linePos` line plus 1 for the fence.
- do#1 (agy_sonnet55) built it test-first: 9 failures before the fix. It
  bumped `taskFileParserVersion` from 4 to 5 and added a cache test.
  check#1 passed.
- review#1 (oc_go_spark_xh) approved. It ran a scratch reversal (2 fail)
  and measured the cost. Three of its citations do not open
  (`src/todoFile.ts`).

## Controller review (intensive)

- What to build: 1 is done (`readFrontmatter` strips `yaml`'s suffix and
  appends the file's line and column), 2 is done (no trailing colon), and 3
  is done (`errorLine ?? 1` in `parseTaskFile` and `readConfig`).
- Tests: the message test is pinned by `taskFile.test.ts` "syntax errors use
  file coordinates" (LF, CRLF). The `todo edit` stderr is pinned by
  `cli/frontmatter.test.ts` "check and edit agree". Comments: none before the
  run.
- Class probes at `7a9dc10` (`parseTaskFile` directly):
  - correct: blank leading lines (line 4), a BOM, duplicate keys, tab
    indent, bad indent, an unclosed quote, a colon in the value, an error on
    the last line, and a TODO.md config block;
  - wrong: `title: "a\rb"` and `note: "c\rd"` above `x: [`. `splitLines`
    puts `x: [` on line 6, but the report says line 4, because `yaml` counts
    LF only. Filed **72**. The reviewer's lone-CR probe was a single YAML
    line, so it missed this.
- No test files were added, moved or deleted, so there is no timings
  regeneration.
