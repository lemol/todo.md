# 71 A hub registry syntax error ends at a colon

Run `01M5H186F0NY2BYW8386A7NXT6`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `8026792`. The code is `bcf6fb3`.

## Attempts

- triage#1 (oc_go_spark_xh) assessed it.
- do#1 (pi_sol_m) built it test-first, with 2 failures before the fix.
  `yamlFailure` now drops only the colon after `at line N, column M`.
  check#1 passed (1602 tests).
- review#1 (cc_opus_m) approved. It ran a scratch reversal (2 fail) and a
  17-input class probe. Its citations open.

## Controller review (intensive)

- What to build: 1 is done (`yamlFailure`'s anchored replace). The message
  ends the way 69's does, but 71 gets there by regex where 69 uses
  `linePos`. 2 is done: messages without a position are still pinned by the
  "alias failures" tests and the not-a-map tests.
- Tests: pinned by `registry.test.ts` "syntax errors keep their file
  position without a dangling colon" (both inputs). `bin.test.ts`'s bad
  registry case asserts an alias, so it needed no change. Comments: none
  before the run.
- Class probe at `8026792` (`parseDocument`): `projects:\n  a: "x\ry"\n
  b: [\n` reports line 4, but `splitLines` says line 5. The brief's premise
  ("`yaml`'s line is the file's line") fails on a lone CR, and 72 rules
  the registry out. Filed **73**. The reviewer's probe tried CRLF but not a
  lone CR, the same miss as in 69's review.
- No test files were added, moved or deleted, so there is no timings
  regeneration.
