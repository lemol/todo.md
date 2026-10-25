# 64 Frontmatter the writer edits by lone-CR lines still reads as invalid

Run `01M5GSN1918XK88YR3V42Q38CC`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `d8f93e1`. The code is `f926172`.

## Attempts

- triage#1 (oc_go_spark_xh) assessed simple/low backend and routed to the
  reviewed flow.
- do#1 (cc_sonnet_m) added one `parseYaml` helper in `frontmatter.ts`,
  used by both `readFrontmatter` and `frontmatterEdits`, bumped
  `taskFileParserVersion` from 3 to 4, and updated the README. It reverted
  `src/` itself and saw the three new reader tests fail.
- check#1 passed (`bun run check`, 1561 tests). It waited about 3 minutes
  for the machine gate slot, which another land held.
- review#1 (pi_sol_m) approved. It reversed assertions and the source in a
  detached scratch worktree, class-probed CR-separated keys, flow maps,
  nested and malformed YAML and the `TODO.md` reader, and measured cost.

## Controller review (intensive)

- Tests first, all in `test/markdown/taskFile.test.ts` under "frontmatter
  read with lone CRs as line breaks":
  - The LF and CRLF read is "reads keys the raw YAML cannot parse (%s)".
  - The round trip is "an edit reads back through the parser".
  - The raw-valid `"a\rb"` case is "raw-valid YAML keeps a lone CR as
    content".
  - The fails-both-ways case is "YAML that fails both ways is invalid".
- The reversals were the implementer's and the reviewer's. I did not
  repeat them.
- What to build 1 to 3: all done (`parseYaml`, `taskFile.ts`, the README).
- Comments: none before the run. The only comment is the orchestrator's closing one.
- The cache: `src/fs/parsing.ts` keys task-file parses by
  `taskFileParserVersion`. `TODO.md` parses are cached in memory only, by
  source, so the bump covers every cached read.
- One unreported change: the writer used to fall back to lone-CR lines
  also when the raw YAML parsed without errors to something other than a
  block map. Now it falls back only on errors. I fuzzed 80,826 distinct
  lone-CR inputs through the old (`04c46dd`) and new `frontmatterEdits`.
  Ignoring inputs where both throw, every difference was on the
  whole-frontmatter rewrite path (for example `# c\r{a: 1}\n{a: 1}`). The
  new code keeps `a: 1` there, and the old code dropped it. No key-level
  edit changed.
- Class probes at `d8f93e1`: block scalars (`title: |\r  a\r  b`) and
  comments between CR-separated keys now read. Duplicate keys and nested
  mappings under a scalar still fail both ways, as they should.
- **Found, predates 64:** an unresolved alias (`x: *a`) parses without
  errors but throws from `toJS()`. One such task file makes `todo list`,
  `todo check` and `todo show` of any other task exit 1 with a stack trace.
  Filed as 65.
- No timings regeneration: a test file was modified, and none were added,
  moved or deleted.
