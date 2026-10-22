# 63 A lone carriage return desyncs Markdown positions from the line model

Run `01M5GR8TK2F1K4NYQ383K3PZMA`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `57a5cc6`. The code is `e69372c` and `608ede9`.

## Attempts

- triage#1 (cc_sonnet_m) assessed moderate/medium backend and routed to
  the planned flow.
- plan#1 (cx_sol_m) reported stuck. Its probes showed that YAML reads a
  lone CR as content (`title: "a\rb"` is valid and the LF form is not), so
  fixing `splitLines` alone still loses the title. It asked whether lone
  CRs must survive as source, and recommended that they do. The deputy
  escalated the question and the person answered `goto:plan` with no
  decision.
- plan#2 (cc_opus_hg) decided it: `splitLines` counts a lone CR, a new
  `Lines.breaks` keeps it on untouched lines, `frontmatterEdits` returns
  line splices from a raw-first parse with a CR-as-break fallback, plus a
  new `lineAt` and a `taskFileParserVersion` bump from 2 to 3.
- do#1 (oc_go_spark_m) built the plan in two commits. Its one deviation is
  an inline `isMap(map) && !map.flow` guard for TypeScript narrowing.
- check#1 passed (1556 tests).
- review#1 (cc_sonnet_m) approved. It mapped each required test and probed
  block scalars, multi-line values and a classic-Mac file. It skipped the
  reversal ("my sed in the scratch copy failed").

## Controller review (intensive)

- Tests first, all in `test/markdown/`:
  - The frontmatter cases on LF and CRLF are `taskFile.test.ts` "lone
    carriage returns" > "changing a key in %j keeps every other line" (5
    rows) and "rewriting a value that holds a lone CR replaces all of its
    lines".
  - `parseTodoFile`, `removeItem` and `insertItem` are `todoEdits.test.ts`
    "parseTodoFile reads every item at its own lines", "removeItem removes
    exactly one item and keeps the lone CR elsewhere" and "insertItem and
    setItemHead edit only their own lines".
  - The description edit before `## Comments` is "replacing the
    description keeps the comments".
- Reversals, in a scratch copy under the worktree (removed afterwards):
  - Reverting `splitLines` to `/\r?\n/` fails 15 tests: all of the above,
    plus the `lines.test.ts` rows.
  - Making `joinLines` ignore `breaks` fails 12 of `test/markdown`.
- What to build 1 and 2: done (`src/markdown/lines.ts`, `frontmatter.ts`,
  `taskFile.ts`), and the README's line-ending rule says why.
- Comments: none before the run.
- Every `Lines` value comes from `splitLines` or `spliceLines`
  (`grep -rnE "splitLines|joinLines|spliceLines|…" src`), so `breaks` cannot
  fall out of step. `src/fs/parsing.ts` caches only task-file parses, never
  `Lines`.
- Class probes (scratch scripts at `57a5cc6`):
  - Correct: a quoted CR plus a new key, the CR-as-break fallback (edit and
    append), lone-CR fences, a body that ends in CR, a description plus
    comments, and a classic-Mac `removeItem`.
  - YAML that fails both ways still rewrites the whole frontmatter from
    what parsed, and so loses the title. That predates 63 (the same happens
    on LF at base).
  - **Gap:** the writer's CR-as-break fallback has no reader counterpart.
    `parseTaskFile("---\ntitle: T\rassignee: z\n---…")` reports
    `invalid-frontmatter`, while `updateTaskFile` edits `assignee` as a key,
    and reading back still shows nothing. Filed as 64. The reviewer missed
    it: it did not class-check the new fallback parse against the reader.
- Spec §2.1 ("Writers preserve the line ending style") still holds. The
  dated `docs/superpowers/plans/2026-09-12-markdown-module.md` still names
  `setFrontmatterFields`. It is a plan record, so I left it.
- No timings regeneration: tests were modified, none added, moved or
  deleted.
- Friction for nzila (not filed here): the person answered plan#1's
  question with a bare `goto:plan`, which left the preservation rule to the
  next planner. `rating.ts` must still run with the nzila checkout as cwd.
