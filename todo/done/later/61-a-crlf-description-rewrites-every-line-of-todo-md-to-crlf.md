---
title: A CRLF description rewrites every line of TODO.md to CRLF
tags: [bug, markdown]
group: Later
completed_at: 2026-10-22T02:30:27Z
outcome: completed
---
Controller probe on `877b01e` (todo-md:59's landing), scratch list under the attempt directory with `HOME`/`TODO_MD_HOME` isolated: an LF `TODO.md` (`# L`, `## Later` with one item and two blank lines, `## Next`), then `printf 'Body\r\n' | todo add T --group Later --description -`. Every line of `TODO.md` comes back ending in `\r\n` (`od -c`: `#   L \r \n \r \n # # ...`), not just the new item line. The task file itself is LF (`Body\n`). The base before 59 (`2660661`) does the same, so 59 did not cause it; 59's reviewer named the CRLF input as untried.

Likely path: `formatInlineItem` keeps `Body\r` as a description line, the inline item is spliced in with the file's `\n`, so the text now holds one `\r\n`. The next read (`promote`) runs `splitLines` (`src/markdown/lines.ts`: `const eol = text.includes("\r\n") ? "\r\n" : "\n"`), takes CRLF as the file's line ending, and `joinLines` writes every line back with it. That breaks spec §2.10's minimal diffs. Confirm the path before fixing.

#### What to build

1. Stop a `\r` in a description reaching `TODO.md` as part of a line: a CRLF (or lone CR line end) description is split on `\r?\n` like the file's own lines, at the boundary where descriptions become item lines.
2. Decide whether `splitLines`'s "any `\r\n` means CRLF" rule should stand for a mixed file; say the decision in the markdown module's README, and change it only if the decision says so.

#### Tests first

- CLI or store test: an LF `TODO.md`, `add --group <existing> --description -` with stdin `Body\r\n`; `TODO.md` differs by exactly the item line, all LF. Red before the fix.
- The same with `--inline`: the item's lines are LF, `Body` carries no `\r`.
- A CRLF `TODO.md` with an LF description stays all CRLF.

#### Done when

A description's line endings never change the line endings of the rest of `TODO.md`.

#### Out of scope

Leading blank description lines (probed on `877b01e`: an inline item with stdin `\nBody\n` parses back with description `Body`).

## Comments

### @agent at 2026-10-22 02:30:27 +00:00

Done: Path confirmed (red tests reproduce it): formatInlineItem split descriptions on "\n" only, so `Body\r` reached TODO.md and the next splitLines saw a `\r\n` and rewrote the whole file as CRLF. Task files (comments, formatTaskFile, updateTaskFile) had the same split.

Changes:
- New `textLines` in src/markdown/lines.ts splits on `\r\n?|\n`. It is used in formatInlineItem and in the three taskFile.ts sites.
- Decision (in src/markdown/README.md): splitLines now gives a mixed file its most common line ending, LF on a tie. The old "any CRLF means CRLF" rule rewrote every LF line for one stray CRLF. Per-line endings are not kept.
- Tests added first and seen red: the three CLI scenarios from the task (LF list with CRLF description, --inline with CRLF, lone CR and multi-line, CRLF list with LF description), plus lines, items and taskFile unit tests. 12 failed before the fix.
- I made one commit instead of the plan's three. The tasks were small and interdependent.

Verified (all pass, 0 fail):
- `bun test test/markdown test/cli/tasks.test.ts test/fs test/jira/mapping.test.ts test/web/ui.test.tsx test/boundaries.test.ts`: 503 pass.
- `bun run lint` and `bun run typecheck`, run separately, are clean.
- Search for related tests: I used the plan's grep over `\r` and `CRLF` in src and test. I did not run the full gate.

Follow-up for the controller to file (out of scope): editing a CRLF task file's frontmatter writes `\r\r\n`, because setFrontmatterFields (frontmatter.ts:55,67) splits yaml on "\n" only.

Review: approved (5/5)
Review of e420743 (todo-md:61) — approved.

What was read: full diff 5b40be7..HEAD (8 files), src/markdown/lines.ts, items.ts, taskFile.ts, frontmatter.ts, todoFile.ts, convert.ts, src/markdown/README.md, docs/spec.md §§2.1/2.10, plan at <attempts>/01M5GNZRWN0G0QSJZMFBKZSW05/plan.md, task file todo/later/61-a-crlf-description-rewrites-every-line-of-todo-md-to-crlf.md (26 lines). Tree clean (git status empty).

Task brief required cases and where pinned:
- LF TODO.md + `add --group <existing> --description -` stdin `Body\r\n`, TODO.md differs by exactly item line, all LF: pinned by test/cli/tasks.test.ts:291 "a CRLF description added to an LF list changes only the item line". Reversal to base lines.ts (5b40be7) makes CLI filter 1 pass 4 fail (new tests red); with fix all pass. Where assertion is over request-supplied value, reversal in scratch worktree shows pinning: breaking textLines to split("\n") makes test/cli/tasks.test.ts --inline variants fail and test/markdown/items.test.ts:74 fail (see evidence below); restoring both to base makes first CLI test fail too (promote path rewrote whole file CRLF under old splitLines rule).
- Same with --inline, LF lines, Body carries no \r (incl. lone CR and multi-line): pinned by test/cli/tasks.test.ts:317 `--inline writes "Body\r\n"/"Body\r"/"Body\r\n\r\nMore\r\n" as LF lines` (3 cases) plus test/markdown/items.test.ts:74 "inline item splits a description on any line ending" (A\r\n\r\nB\rC). Reversal (textLines -> split("\n")) gives items.test.ts 14 pass 4 fail and CLI --inline 2 pass 3 fail; fixed tree gives 115 pass 0 fail across the 4 touched suites.
- CRLF TODO.md with LF description stays all CRLF: pinned by test/cli/tasks.test.ts:338 "an LF description added to a CRLF list keeps it CRLF". Passes before and after (regression guard by design); forced `eol="\n"` makes it fail (plan's known-bad, re-verified pattern via mixed-lines reversal).
- Done-when "A description's line endings never change the line endings of the rest of TODO.md": covered by above plus test/markdown/lines.test.ts:58 "mixed line endings" (majority wins, LF on tie) and test/markdown/taskFile.test.ts:412 "carriage returns in new text" (3 tests). All pass.
- Property: generator is fixed fixtures, not a fuzzer; input class ruled out is any-\r-in-new-text (CRLF, lone CR, multi-CRLF). Deliberately not tried: \v \f NEL U+0085 LS/PS (not CommonMark line endings, out of spec).

What to build:
1. Stop \r reaching TODO.md at description-becomes-item-lines boundary: DONE. src/markdown/lines.ts:25 `textLines = text.split(/\r\n?|\n/)` used in src/markdown/items.ts:40 (formatInlineItem), src/markdown/taskFile.ts:231 (commentLines), :259 (formatTaskFile), :297 (updateTaskFile). Covers CLI/store/web (core/fs pass description through untouched; no other description split in src/core|src/fs besides unrelated path splits).
2. Decide splitLines mixed-file rule, say in README, change only if decided: DONE. src/markdown/lines.ts:11-14 counts CRLF vs LF, `crlf > lf ? "\r\n" : "\n"` (LF on tie/empty => new files LF per spec §2.1). src/markdown/README.md:37-43 documents most-common-wins, minority rewritten, per-line endings not kept. Code and sentence agree.

Comments: read the task file Comments section at review time: none (file is 26 lines, ends at Out of scope; no `## Comments`). Brief carries no "Pre-start task comments" section. So 0 comments, 0 authors — checked, not assumed. Nothing to walk.

Implementer's stated gaps:
- CRLF task-file frontmatter edit writes \r\r\n (frontmatter.ts:55,67 split yaml on "\n"): NOT DONE, correctly pushed back — frontmatter, not description/comment text; plan's "Not in this plan" and task scope exclude it. Reported as follow-up for controller. Verified out-of-scope; no change required here.
- Single commit instead of plan's three: DONE with reason (small interdependent tasks). No repo rule requires one commit per plan task; message `fix(markdown): ...` follows convention. Not a finding.
- Leading blank descriptions out of scope: untouched, as tasked.

Orchestrator commits vs rule: one commit e420743 on branch; answers the task (fix + decision + tests). No commit outside its rule, no hygiene-only commit, no install/config change. boundaries.test.ts still passes (check stage green).

Decision contradiction: none. README "most common (LF on tie), CRLF files stay CRLF" matches code: pure CRLF (crlf>0,lf=0) -> CRLF; pure LF -> LF; empty -> LF. Spec §§2.1/2.10 still match (preserve style for uniform files; minimal diff = rewrite minority only under one-ending model).

check.command: `bun run check` (from artifacts check.command; Done-when names no command, so no divergence). check.passed=e420743 == HEAD. I ran the touched parts, leaving the gate to check: `bun test test/markdown/lines.test.ts test/markdown/items.test.ts test/markdown/taskFile.test.ts test/cli/tasks.test.ts` => 115 pass 0 fail; `bun test test/markdown/todoEdits.test.ts test/fs/links.test.ts` => 67 pass 0 fail; `bun run lint` clean; `bun run typecheck` clean (no output).

Linter: 0 warnings, all `oxfmt --check` clean; base had 0. From project linter alone (`bun run lint` => `All matched files use the correct format`, oxlint no findings). N=0, M=0, no increment to attribute.

Cost at scale: splitLines now does two regex counts instead of one includes. Measured: `bun -e` 10k iterations on ~700B TODO.md x100 => includes 3.1ms, regex-count 8.9ms. Per-edit cost <1µs extra; TODO.md edits are single-file, lock-held, negligible. Command and output above.

Searches (prove before believe; search ran against side holding the text, so non-empty there proves the tool works):
- `rg -n "split\(\"\\\\n\"\)|splitLines|textLines" src/` finds textLines in lines.ts:25, items.ts:40, taskFile.ts:231,259,297 and remaining `split("\n")` only in frontmatter.ts:14,36,55,67 (yaml/error paths, expected per plan), jira/mapping.ts:232 + jira/adf.ts:114 (ADF, normalizes \r\n? itself), cli/render.ts:51 (display indent), metadata/paths splits (different domains). No stale description split remains.
- `rg -n "\\\\r" src/ test/` finds the new tests plus pre-existing CRLF fixtures (todoEdits.test.ts:58, fs/links.test.ts:27,238) and unrelated header-string test (web/ui.test.tsx:101). No other copy of removed rule `text.includes("\r\n")` remains (only base had it).
- Phrase search for removed README sentence "CRLF files stay CRLF" now only in new README context (lines 37-43), no stale duplicate found.

Class checks for predicates:
- textLines tried: a, a\nb, a\r\nb, a\rb, a\r\n, A\r\n\r\nB\rC, Body\r\n, Body\r, Body\r\n\r\nMore\r\n. Not tried: \v\fNEL (not CommonMark endings) — reason stated.
- splitLines eol tried: pure LF, pure CRLF, mixed majorities both ways, tie -> LF (lines.test.ts:58-63). Not tried: lone-CR-only file (no \n) stays single-line — pre-existing splitLines body.split(/\r?\n/) behavior, out of scope, no test claims it.
- External event: another tool leaves mixed endings; reaction (majority wins, one rewrite, then stable) holds on retry — second edit sees uniform file, no flap.

No open findings.


Citations that do not open (the verdict stands; a finding may still be right):
- `jira/mapping.ts:232` path does not exist
- `jira/adf.ts:114` path does not exist
- `cli/render.ts:51` path does not exist
- `fs/links.test.ts:27,238` path does not exist
- `web/ui.test.tsx:101` path does not exist
