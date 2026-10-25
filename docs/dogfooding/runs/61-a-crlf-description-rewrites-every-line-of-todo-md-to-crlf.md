# 61 A CRLF description rewrites every line of TODO.md to CRLF

Run `01M5GNZ5RJS3CCR28R3N3K1PC0`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `6af1afe`. The code is `accf447`.

## Attempts

- triage#1 (cc_sonnet_m) assessed simple/low backend and routed to the
  planned flow.
- plan#1 (cc_opus_hg) confirmed the path (`formatInlineItem` split on `"\n"`
  only, so `Body\r` reached `TODO.md` and the next `splitLines` read the
  whole file as CRLF), widened it to the three `taskFile.ts` split sites,
  set the mixed-file decision (most common ending, LF on a tie) and found
  the frontmatter follow-up.
- do#1 (agy_sonnet55) built it test-first (12 red before the fix): a new
  `textLines` in `src/markdown/lines.ts`, used in `formatInlineItem`,
  `commentLines`, `formatTaskFile` and `updateTaskFile`; `splitLines`
  counts endings. One commit instead of the plan's three, with its reason.
- check#1 passed (1531 tests) after seven minutes waiting for the machine
  gate slot held by another project's gate.
- review#1 (oc_go_spark_xh) approved: reversed `textLines` and `lines.ts`
  in scratch, class-checked `textLines` and the mixed rule, measured the
  `splitLines` cost. Five citations dropped their `src/`/`test/` prefix and
  the orchestrator flagged them as paths that do not open.

## Controller review (intensive)

- Tests first: (1) CRLF description into an LF list changes only the item
  line: `test/cli/tasks.test.ts`, "a CRLF description added to an LF list
  changes only the item line", asserts the whole `TODO.md`. (2) `--inline`:
  same describe, `--inline writes "Body\r\n"/"Body\r"/"Body\r\n\r\nMore\r\n"
  as LF lines`. (3) CRLF list with an LF description: "an LF description
  added to a CRLF list keeps it CRLF" (passes at base by design). Reversals
  are the reviewer's; I did not repeat them.
- What to build 1: done (`textLines`, four call sites). 2: decided and
  changed, in `src/markdown/README.md` "Line endings"; code agrees. Spec
  §2.1 ("preserve the line ending style") still holds for uniform files.
- Comments: none before the run; the task file now has only the
  orchestrator's closing comment.
- Class probes on `6af1afe` (scratch list, isolated `HOME`): a title with
  `\r` is refused ("Expected a single line"); `todo comment 2 $'c1\r\nc2'`
  writes LF lines; `add --description -` with `Body\r` writes an LF task
  file and changes `TODO.md` by the link line only.
- The frontmatter follow-up reproduced: `updateTaskFile` on a CRLF file
  with `title` and `tags`, changing `tags`, gives `title: T\r\r\n`. Filed
  as 62.
- No timings regeneration: tests were modified, none added, moved or
  deleted.
- Friction for the orchestrator (not filed here, as at 57 to 59):
  `review.ts` and `rating.ts` must run with its checkout as cwd.
