# 72 A lone CR before a frontmatter syntax error shifts its line

Run `01M5H69YMWEPGVP6D5NJCKHPJF`, loop `01M5GFQE4CEH965H2CH9XZYRSS`
(width 1). Landed `b0c1837`. The code is `607d744`.

## Attempts

- triage#1 (oc_go_spark_xh) assessed simple/low backend.
- do#1 (oc_go_spark_m) built it test-first. `readFrontmatter` now maps
  the yaml error's byte offset (`first.pos[0]`) via a new `offsetLineCol`
  helper that counts CRLF, LF and lone CR, then adds 1 for the fence; the
  old `linePos` path stays only as a fallback when `pos` is absent.
  check#1 passed (1608 tests).
- review#1 (oc_go_spark_xh) approved (do scored 5). It ran a scratch
  reversal (1 fail) and a 7-input class probe (LF, CRLF, lone-CR, mixed,
  first-line, unclosed flow, later-col). Its citations open.

## Controller review (intensive)

- What to build: 1 is done (offset map in `src/markdown/frontmatter.ts:40`
  with `/\r\n?|\n/`, the same breaks `splitLines`/`textLines`/`lineAt`
  use; mapped in `text` at `:82`, fence +1 at `:85`). 2 is done: message
  and `errorLine` come from the same line/col at `:87`, and the test
  asserts both.
- Tests: pinned by `test/markdown/taskFile.test.ts:618` "syntax errors
  below a lone CR use file coordinates" (message, `parseTaskFile`,
  `parseTodoFile`, `updateTaskFile` failure, all line 6). 69's LF/CRLF
  test at `:602` still green. Comments: 0, none (no pre-start block,
  `show 72 --json` comments `[]`, no Comments section).
- Class probe at `b0c1837`: brief case gives line 6 col 5; LF and CRLF
  baselines give line 3; CRLF+lone-CR mix gives line 4 (matches
  `splitLines`); first-line `x: [` gives line 2; yaml `pos`/`linePos`
  pairs (`[29,30]`/3:5 task, `[15,16]`/2:5 LF, `[18,19]`/2:5 mix)
  confirm the LF-only undercount. Emoji-before-error and trailing-CR
  probes agree with `splitLines`; the lone-CR-valid second-parse path
  returns data, not an error. No follow-up: 73 already covers the
  registry counterpart, and the `offsetLineCol`/`lineAt` overlap is style,
  not a defect. Filed nothing.
- No test files were added, moved or deleted, so there is no timings
  regeneration.
