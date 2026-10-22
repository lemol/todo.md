---
title: A lone CR before a frontmatter syntax error shifts its line
tags: [bug, markdown]
group: Later
completed_at: 2026-10-22T07:05:14Z
outcome: completed
---
Found by the controller's post-land review of todo-md:69 (landed `d3db970`, closed `7a9dc10`). 69 reports a frontmatter syntax error at "file coordinates": `yaml`'s `linePos` line plus 1 for the opening fence. `yaml` counts lines by LF only, while this repo's line model treats a lone CR as a line ending (`src/markdown/README.md`, "Line endings"; `splitLines` in `src/markdown/lines.ts`; micromark agrees). So every lone CR above the error moves the reported line one short of the file's.

Evidence (probe at `7a9dc10`, calling `parseTaskFile` directly):

- Source `---\ntitle: "a\rb"\nnote: "c\rd"\nx: [\n---\nBody\n`. `splitLines` gives `["---", "title: \"a", "b\"", "note: \"c", "d\"", "x: [", "---", "Body"]`, so `x: [` is file line 6.
- The diagnostic reads `... end with a ] at line 4, column 5`, with `line: 4`.
- With no lone CR (`---\ntitle: Syn\nx: [\n---\nBody\n`), it reads line 3, which is correct. 69's tests cover LF and CRLF only.

A lone CR is legal content in a quoted YAML scalar, and the writer keeps it (README). It is rare, but `todo check` then points at the wrong line, and so does the message every failed write prints.

#### What to build

1. Map `yaml`'s error offset (`first.pos[0]`, an offset into the YAML text) to a file line and column using the same line breaks as `splitLines`: LF, CRLF and lone CR. Then add 1 for the fence. Or state why `linePos` is kept and document the gap in the README.
2. The message and the diagnostic line keep agreeing, as 69 made them.

#### Tests first

- `test/markdown/taskFile.test.ts`, next to 69's "syntax errors use file coordinates": the source above gives line 6 in both the message and the diagnostic's `line`. The same holds for a TODO.md config block (`parseTodoFile`).

#### Done when

A frontmatter syntax error below a lone CR names the line `splitLines` puts it on.

#### Out of scope

The hub registry (71). Lone-CR handling elsewhere.

## Comments

### @nzila at 2026-10-22 07:05:14 +00:00

Done: Fixed the lone-CR frontmatter line shift in `src/markdown/frontmatter.ts`: `readFrontmatter` now maps the yaml error's byte offset (`first.pos[0]`) to a 1-based line/column with a new `offsetLineCol` helper that counts CRLF, LF and lone CR — the same breaks `splitLines` uses — then adds 1 for the opening fence. Keeps the old `linePos` path only as a fallback when `pos` is absent (yaml syntax errors carry `pos`; no README gap to document since `linePos` is no longer used on the error path).

Test-first: added `syntax errors below a lone CR use file coordinates` to `test/markdown/taskFile.test.ts` — source `---\ntitle: "a\rb"\nnote: "c\rd"\nx: [\n---\nBody\n` now reports `at line 6, column 5` with diagnostic `line: 6` in the message, `parseTaskFile`, `parseTodoFile`, and the `updateTaskFile` failure. It failed first with line 4 (yaml's LF-only count), passes after the fix.

Verified: `bun run lint` clean (after `oxfmt` on the touched files), `bun run typecheck` clean, and focused tests green — `test/markdown/{frontmatter,todoFile,taskFile,lines}.test.ts`, `test/cli/frontmatter.test.ts`, `test/fs/{invalidFrontmatter,parsing}.test.ts` (137 pass), plus `test/boundaries.test.ts` (13 pass). Searched `src/` and `test/` for `linePos|readFrontmatter|at line \d+, column` to find value-pinning tests; none regressed. Committed `e4e49d4` on `nzila/01M5H69YMWEPGVP6D5NJCKHPJF`; worktree clean, no probe links left. Did not run the full `bun run check` suite per the brief.

Review: approved (5/5)
review#1 of e4e49d4 (base 9cfb794): approve.

Required cases (brief Tests + Done when):
- Task source `---\ntitle: "a\rb"\nnote: "c\rd"\nx: [\n---\nBody\n` gives line 6 in message and diagnostic line: PINNED in test/markdown/taskFile.test.ts:618 "syntax errors below a lone CR use file coordinates" — readFrontmatter error toBe line-6 message (:623), parseTaskFile diagnostics line 6 (:624-626), parseTodoFile diagnostics line 6 (:627-629), updateTaskFile fail (:630).
- Same holds for TODO.md config block (parseTodoFile): PINNED same test (:627-629).
- Done when (error below lone CR names splitLines line): PINNED same test; splitLines verified as ["---","title: \"a","b\"","note: \"c","d\"","x: [","---","Body"] so x: [ is file line 6 (bun -e splitLines probe).
- Reversal: in a detached scratch copy reversed the single diff-introduced literal to "at line 4, column 5" (yaml LF-only count); `bun test test/markdown/taskFile.test.ts` failed 55 pass/1 fail with Expected line 4 / Received line 6 at test/markdown/taskFile.test.ts:623. Test pins the fix, not the literal.

What to build:
1. Map first.pos[0] via splitLines breaks +1 fence, or document gap: DONE. src/markdown/frontmatter.ts:40 offsetLineCol counts CRLF/LF/lone CR with /\r\n?|\n/ (same as splitLines/textLines/lineAt), src/markdown/frontmatter.ts:82 maps offset in `text` (the text doc was parsed from), src/markdown/frontmatter.ts:85 adds 1 for the fence. Fallback keeps linePos only when pos absent (:73-79); no README gap to document since linePos is no longer on the error path.
2. Message and diagnostic line agree: DONE. src/markdown/frontmatter.ts:87 returns error and errorLine from the same line/col; test asserts both.

Comments: read the brief task text (no Pre-start comments block), `bun src/cli/bin.ts show 72 --json` (comments: []), and todo/later/72-a-lone-cr-before-a-frontmatter-syntax-error-shifts-its-line.md (no Comments section). Count 0, authors none. Nothing to walk.

Implementer gaps / Out of scope: brief lists hub registry (71) and lone-CR handling elsewhere as out of scope — untouched (diff stat: 2 files only). Report's "did not run full bun run check" is COVERED by check stage: check.command `bun run check` passed on e4e49d4 (gate.output: 1608 tests across 109 files, 1480 pass/128 skip/0 fail). "No README gap" is DONE (mapping chosen; src/markdown/README.md:46-47 file-coordinates sentence stays true).

Commits: single commit e4e49d4 "fix(markdown): report frontmatter syntax errors at lone-CR file lines" answers the fix rule; diff touches only src/markdown/frontmatter.ts + test/markdown/taskFile.test.ts, both in scope. No hygiene outside diff.

Decision: brief allowed mapping OR keep-linePos-plus-docs; code does mapping — no contradiction.

Check named: `bun run check` (brief check.command), passed on check.commit e4e49d4. Done-when names no command.

Fixture numbers (not code): yaml text without fence has textLines ["title: \"a","b\"","note: \"c","d\"","x: ["] (5 lines, error on 5th) +1 fence = file line 6; col 5 = len("x: [")+1 end position; yaml probe pos [29,30] with linePos line 3 col 5 confirms LF-only undercount (+2 short from 2 lone CRs). Asserted 6/5 consistent with splitLines totals.

Constraints kept: LF/CRLF still correct (test/markdown/taskFile.test.ts:602 "syntax errors use file coordinates" green), agreement kept, fence +1 in both branches (frontmatter.ts:77 and :85).

Cost at scale (measured, error path only): `bun -e` 20x yaml parseDocument alone on 5000-line lone-CR yaml: 646ms (~32ms/parse); 1000x offset scan alone: 267ms (~0.27ms/scan); 20x full readFrontmatter: 1931ms (dominated by parseYaml double-parse on error path; success path single parse). Scan is O(n) once per syntax error (rare, single file), negligible vs yaml parse. No scale risk.

Spec: docs/spec.md has no line-number contract (rg only invalid-frontmatter diagnostic rows); README file-coordinates sentence stays accurate. No drift. No re-read hazard: synchronous parse of in-memory string param only; frontmatterEdits reuses same string deterministically. No migration.

Predicate class (offsetLineCol regex): tried LF baseline -> line 3, CRLF baseline -> line 3, loneCR task -> line 6, CRLF+loneCR mix -> line 4 (matches splitLines ["---","title: \"a","b\"","x: [","---","Body"]), first-line "x: [" -> line 2, "unclosed: [a, b" -> line 2 col 16, loneCR-later-col -> line 5. All match splitLines. Deliberately did not try block-scalar lone-CR second-parse path, non-BMP offsets (yaml pos vs UTF-16), or trailing bare CR at EOF — out of scope (lone-CR elsewhere) and no repo fixture; existing 69/lineAt tests cover the shared regex.

External side (yaml lib, real record via `bun -e parseDocument`): task yaml msg "...at line 3, column 5" pos [29,30] linePos [{line:3,col:5}]; LF baseline pos [15,16] linePos 2:5; CRLF+loneCR pos [18,19] linePos 2:5 — proves LF-only counting. Synchronous, no retry/second event. No pos-absent parser error observed on this machine; fallback branch preserves 69 behavior (defensive, acceptable).

Modules: no new module/dir; test colocated as brief required (next to 69 test).

Linter: gate recorded `Found 0 warnings and 0 errors` for `bun run lint && bun run typecheck && bun run test`; direct `bun run lint` on worktree exits 0, oxfmt clean on 268 files (oxlint silent on success). No increment to attribute. Base lint not separately recorded; nested-scratch lint run invalid (double-scan/plugin double-register artifact), not a regression.

No new config/flag/intent; helper producer is src (readFrontmatter), not tests-only.

Verification observed (not predicted): `bun test` on 8 touched files: 150 pass 0 fail; `bun run typecheck` clean; `bun run lint` clean. Full `bun run check` left to check/land stages per instructions; gate already green.

Branch: nzila/01M5H69YMWEPGVP6D5NJCKHPJF

nzila run 01M5H69YMWEPGVP6D5NJCKHPJF
