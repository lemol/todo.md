# 62 Editing a CRLF task file's frontmatter writes a stray carriage return

Run `01M5GQBC812V17ZGK5JA1NC78H`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `ca024dd`. The code is `1ee7a07`.

## Attempts

- triage#1 (oc_go_spark_xh) assessed simple/low backend and routed to the
  planned flow.
- plan#1 (cx_sol_m) confirmed the path (the raw mdast YAML value split on
  `"\n"`), ran six proposed tests red at base, and planned `textLines` for
  the kept lines, one LF-normalized source for `parseDocument`,
  `readFrontmatter` and `lineOf`, a `textLines` split of the YAML error
  message, and a `taskFileParserVersion` bump.
- do#1 (oc_go_spark_m) built it as planned in one commit, 6 red then 136
  green on the focused suites.
- check#1 passed (1537 tests).
- review#1 (cc_opus_md) approved. It pinned every test, ran three
  reversals and probed CRLF block scalars, block sequences, appends,
  flow maps and invalid YAML. It noted that normalization "only matters for
  lone-CR input" but didn't probe that input.

## Controller review (intensive)

- Tests first: change, delete and append on a CRLF file:
  `test/markdown/taskFile.test.ts`, the three "… preserves other CRLF lines"
  tests, whole-file `toBe`. CLI: `test/cli/tasks.test.ts`, "todo edit --tag
  preserves CRLF task frontmatter". The reviewer's reversals cover what makes
  these fail; I did not repeat them.
- What to build 1 and 2: done (`src/markdown/frontmatter.ts`). The
  diagnostic fix and the parser-version bump are in scope.
- Comments: none before the run.
- Class probe (lone CR, out of the brief's scope), scratch scripts on
  `ca024dd` and on base `0fef681`:
  - `title: "a\rb"` in an LF file, then change `tags`: both commits drop
    the closing `---`.
  - The same in a CRLF file: base drops the fence. `ca024dd` also drops the
    title line, because `textLines` now counts the lone CR while the splice
    range from `lineSpan(yaml)` doesn't.
  - A lone CR in a YAML comment: `ca024dd` drops the title and the fence.
  - `parseTodoFile` with a lone CR in one item: the next item vanishes and
    the one after is titled `"hre"`.
  - Cause: mdast counts a lone CR as a line ending and `splitLines` doesn't.
    Filed as 63.
- No timings regeneration: tests were modified, none added, moved or
  deleted.
- Friction for the orchestrator (not filed here, as at 57 to 61):
  `rating.ts` must run with its checkout as cwd.
