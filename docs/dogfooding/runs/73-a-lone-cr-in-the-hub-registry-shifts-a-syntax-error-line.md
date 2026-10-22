# 73 A lone CR in the hub registry shifts a syntax error line

Run `01M5H70907897M4EGGFKS9K0BN`, loop `01M5GFQE4CEH965H2CH9XZYRSS`
(width 1). Landed `4633831`. The code is `bdbf892`.

## Attempts

- triage#1 (oc_go_spark_xh) assessed simple/low backend.
- plan#1 (cx_sol_m) planned a one-commit fix following 72's
  LF/CRLF/lone-CR offset convention with a private hub helper.
- do#1 (pi_sol_m) built it test-first. `yamlFailure` now maps
  `YAMLParseError.pos[0]` via a local `offsetLineCol` that counts LF,
  CRLF and lone CR, replacing yaml's LF-only `at line N, column C`;
  files without any LF keep yaml's message (all-CR out of reach per
  the brief). check#1 passed (1612 tests, 1484 pass/128 skip/0 fail).
- review#1 (oc_go_spark_xh) approved (do scored 5). It ran a scratch
  reversal (3 fail on base, all-CR row unchanged) and a 10-input
  class probe. Its citations open.

## Controller review (intensive)

- What to build: 1 is done (private `offsetLineCol` in
  `src/hub/registry.ts:54` with `/\r\n?|\n/g`, mapped at `:226`;
  no markdown import, so architecture/boundaries unchanged — the
  allowed alternative). 2 is done: 72's outcome was read first;
  the helper regex matches frontmatter's and the suffix matches,
  minus the fence +1 the registry has no use for. 3 is done: the
  `text.includes("\n")` guard at `:225` preserves yaml's message,
  pinned by the all-CR row.
- Tests: pinned by `test/hub/registry.test.ts` "syntax errors keep
  their file position without a dangling colon" (LF row `:165-166`
  expects 5:1, CRLF-mix row `:169-170` expects 5:1, alias row
  `:173-174` expects 4:12, all-CR row `:177-178` expects yaml's
  1:10). Comments: 0, none (no pre-start block, no Comments
  section; implementer report mentions none — consistent).
- Class probe at `4633831` (`parseDocument`, controller's own):
  required input `pos [28,29]`/yaml 4:1, CRLF-mix `[31,32]`/4:1,
  alias `[32,34]`/3:12, all-CR `[9,10]`/1:10 — exactly the one-line
  lone-CR shift the four new rows assert, and the preserved
  exception. Focused suite on the tip: 32 pass, 0 fail. Absence
  proofs re-run: `from.*markdown` in `registry.ts` empty;
  `Keep the file position` hits only base `518c2f7:193` (search
  works) and the reviewer's own quote line in the done file — no
  live stale copy. The `offsetLineCol`/`lineAt` overlap is style
  per 72's review, not a defect. Filed nothing.
- No test files were added, moved or deleted, so there is no timings
  regeneration.
