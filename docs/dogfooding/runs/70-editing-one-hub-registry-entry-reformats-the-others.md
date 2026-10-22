# 70 Editing one hub registry entry reformats the others

Run `01M5H1RGRR2RVDY3M821SY4P4F`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `f0171dd`. The code is `8ac7a9d` (splice) + `01f5110` (README).

## Attempts

- triage#1 (cc_sonnet_m) assessed moderate/low backend.
- plan#1 (cc_opus_hg) chose (b), splicing, with a probe that (a)
  (`toString` with `lineWidth: 0`, `flowCollectionPadding: false`) still
  rewrites padded maps, 4-space indents and extra spaces.
- do#1 (pi_sol_m) built it test-first, with 5 failures before the fix.
  `editOf` splices via node ranges; missing/empty/flow `projects` falls back
  to `Document` with no folding or padding. check#1 passed (1607 tests).
- review#1 (oc_go_spark_xh) approved. It ran a scratch reversal (23 pass /
  5 fail) and class probes (rename quoting, blank/deeper comments, header,
  missing-key noop, delete-last, add-then-delete, 4-space add, no-trailing-nl,
  seq ops, CRLF). Its citations open.

## Controller review (intensive)

- What to build: 1 is done (block-map splice only the touched entry:
  `rename` replaces the key range `src/hub/registry.ts:164`, `delete`
  removes the entry plus same-indent `#` lines above `:135-148`, `add`
  appends indented like the first entry `:97-109`; fallback `Document`
  `:178` for missing/empty/flow). 2 is done (README splice bullet
  `src/hub/README.md:68-76`).
- Tests: pinned by `test/hub/registry.test.ts` "an edit leaves the entries
  it does not touch as written" (`:209-229` delete/rename/add over
  `untouched` `:197-205`, long line 105 cols, padless/padded/deep/trailing
  comment), "delete takes the comment lines" (`:231-242`), and "flow
  projects map rewrites on one line" (`:244-257`). Comments: the task file
  has no Comments section and the brief has no pre-start comments; 0, none.
- Class probe at `f0171dd`: CRLF `delete` preserves `...\r\n`, `add` appends
  `\n` (mixed endings, plan-scoped out, others preserved so Done when
  holds). A lone-CR registry (`projects:\r  a: ...`) fails `read` with 3
  yaml errors, so the splice path is never reached; 73 covers the registry
  lone-CR line shift. No new task filed.
- No test files were added, moved or deleted, so there is no timings
  regeneration.
