# 59 A description ending in a newline adds a stray blank line to TODO.md

Run `01M5GN24YAX4XK8SEM65Z652XK`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `877b01e`. The code is `bad8c46`.

## Attempts

- triage#1 (oc_go_spark_xh) assessed simple/low backend and routed to the
  planned flow.
- plan#1 (cx_sol_m) traced the cause: `formatInlineItem` split `Body\n`
  into `["Body", ""]`, the parser ends the item before the blank, so the
  promotion `add` runs replaced only the parsed span and left the blank.
  Planned one commit at the formatter.
- do#1 (pi_sol_m) built it test-first: 46 pass, 10 red before the fix;
  `formatInlineItem` pops terminal blank description lines.
- check#1 passed (1511 tests) after half a minute waiting for the machine
  gate slot.
- review#1 (cc_opus_m) approved: reversed `items.ts` in scratch (10 red),
  probed `add --inline`, `edit --description -` then `promote`. Named CRLF
  and leading blank lines as untried.

## Controller review (intensive)

- Tests first / Done when: pinned in `test/cli/tasks.test.ts`, describe
  "add preserves section spacing", case `"Body\n", stdin=true` and its
  literal twin, plus formatter cases in `test/markdown/items.test.ts`.
  The review's reversal showed them red; I did not repeat it.
- What to build 1 (stop the newline reaching the splice): done in
  `src/markdown/items.ts`. 2 (stdin vs literal final newline): done, both
  normalize, said in `src/cli/README.md`.
- Comments: the brief had none; the task file has only the orchestrator's
  closing comment.
- Real use: filing 61 with a heredoc `todo add --description -` changed
  `todo/TODO.md` by the item line only.
- Class probes on `877b01e` (scratch list, isolated `HOME`): stdin
  `\nBody\n` and `\n\n` add only the item line; `--inline` with
  `\nBody\n` reads back as description `Body`. Stdin `Body\r\n` rewrites
  every line of `TODO.md` to CRLF, at `2660661` too, so it predates 59:
  filed as 61.
- No timings regeneration: tests were modified, none added, moved or
  deleted.
- Friction for the orchestrator (not filed here, as at 57 and 58):
  `review.ts` and `rating.ts` resolve the CLI from the repository root, so
  from todo-md they run `todo show` and fail; run them with the
  orchestrator's checkout as cwd.
