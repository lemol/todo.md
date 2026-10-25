---
title: A description ending in a newline adds a stray blank line to TODO.md
tags: [bug, cli]
group: Later
completed_at: 2026-10-22T02:07:08Z
outcome: completed
---
Filing 57 and 58 on `756b909` with `todo add --description - <<'EOF'` left two extra blank lines in `todo/TODO.md`, one per add, besides the item lines (removed by hand before commit). Probe in a scratch copy of that `TODO.md` (`todo add --dir <copy> --group Later …`, diffing before and after):

- `--no-description`, `--description plain`, `--description "$(printf 'A\n\nB')"`, and stdin `Body` with no final newline: only the item line is added.
- stdin `Body\n` or `Body\n\nMore\n` (what every heredoc gives): the item line plus one blank line further down the file, after the section's trailing blank lines.

So a description that ends in a newline changes `TODO.md` beyond the item, against spec §2.10's minimal diffs. The `--description -` help text recommends exactly the heredoc that triggers it.

#### What to build

1. Find where the description's trailing newline reaches the `TODO.md` splice (the item lines, or the section's end offset) and stop it: `add` inserts the item's lines and nothing else.
2. Decide whether a stdin description keeps or trims its final newline in the task file, and keep that consistent with `--description <text>`.

#### Tests first

- A CLI or store test: `add --group <existing group> --description -` with stdin `Body\n` against a `TODO.md` whose section is followed by blank lines and another heading; the diff of `TODO.md` is exactly the one item line. Red before the fix.

#### Done when

`add` with a newline-terminated description changes `TODO.md` by the item line only.

## Comments

### @agent at 2026-10-22 02:07:08 +00:00

Done: Implemented plan in commit 3fdda96 (clean worktree).

formatInlineItem now discards only terminal blank description lines before formatting. This prevents blank lines escaping the parsed item and surviving promotion; parser offsets, splicing and stdin transport are unchanged. Internal blank lines and Markdown hard-break spaces remain intact. Documented existing task-file policy: literal and stdin descriptions normalize trailing blank lines and end with one newline; add JSON retains raw input.

Tests first: integrated CLI exact-file regressions for stdin/literal Body, Body\n, multiline bodies and multiple terminal newlines, plus formatter whitespace/hard-break regressions. Before fix: 46 pass, 10 expected failures, including stdin Body\n failing exact TODO.md equality. Final focused command:
`bun test test/markdown/items.test.ts test/markdown/convert.test.ts test/markdown/todoEdits.test.ts test/markdown/todoFile.test.ts test/fs/writing.test.ts test/fs/promotion.test.ts test/fs/conformance.test.ts test/cli/tasks.test.ts test/cli/bin.test.ts`
Result: 236 pass, 0 fail. Tests used attempt-local TMPDIR/HOME/TODO_MD_HOME. Logs: red.log, focused.log in this attempt.

Separate checks: bun run lint passed; bun run typecheck passed; git diff --check passed. Initial lint failure was one new missing blank line in the CLI test, corrected and verified. Exploratory rg named nonexistent src/fs/tasks.ts; corrected localization found FsTodoStore.ts/writing.ts. No failures attributed to the base.

Repeated searches:
`rg -n 'formatInlineItem|inlineItemFor|itemLinesFor' src/ test/`
`rg -n 'formatInlineItem|trimBlock|description.*\\n|byte for byte' src/ test/markdown/items.test.ts test/markdown/convert.test.ts test/cli/bin.test.ts`
Consumers found in convert.ts, writing.ts, FsTodoStore add/update/comment/promote paths; existing focused targets cover conversion, promotion, metadata and CLI stdin/JSON. Results saved in consumer-search.log. No harness changes.

A rerunnable bun -e parser/replace probe and its observed span [5,7], description Body, extraBlankSurvives=true are recorded in the progress note, evidencing the formatter comment's claim about unchanged parser behavior.

No plan deviations or unmet acceptance conditions. Full gate/full suite intentionally not run per stage instructions; the check stage owns them. No installs/shared dependency writes, scratch worktrees, external checkout changes or task-list edits. Subsequent independent review remains with the orchestrator.

Review: approved (5/5)
Approved. Diff read whole from base 2660661 to 3fdda96: src/markdown/items.ts (+6), src/cli/README.md (+2/-1), test/cli/tasks.test.ts (+45/-1), test/markdown/items.test.ts (+20).

Root cause and fix: `formatInlineItem` split "Body\n" into ["Body", ""], emitting a blank item line; the parser ends the item before it, so promotion (default `add` runs `todo.promote`, src/cli/commands/tasks.ts:160) replaced only the parsed span and left the blank behind. The fix pops terminal blank description lines in the formatter (items.ts: `while (description.length > 0 && isBlank(description[description.length - 1]))`), which every inline writer shares: `inlineItemFor` (convert.ts) → `itemLinesFor` (src/fs/writing.ts:30) → FsTodoStore add/edit/comment/promote (FsTodoStore.ts:253, 288, 580, 603).

What to build:
1. Stop the newline reaching the splice — done, in items.ts formatInlineItem.
2. Stdin vs literal final newline in the task file — done: both normalize trailing blank lines and end with one newline (existing taskFile behavior), documented in src/cli/README.md ("Default `add` task files normalize trailing blank description lines ... identically for literal and stdin descriptions") and pinned by the stdin=true/false pairs asserting `md(..., body.trimEnd())`.

Tests / Done when:
- "add --group <existing> --description - with stdin Body\n against a section followed by blank lines and another heading; diff is exactly the item line" — pinned in test/cli/tasks.test.ts, describe "add preserves section spacing", test `"Body\n", stdin=true` (fixture: Later section, item, two blank lines, `## Next`). It fails if TODO.md differs from `before` with exactly one link line inserted after "- [ ] 01 - Existing". Reversed in a scratch worktree (git checkout 2660661 -- src/markdown/items.ts): `bun test test/cli/tasks.test.ts test/markdown/items.test.ts` → 46 pass, 10 fail (6 CLI cases Body\n, Body\n\nMore\n, Body\n\n × stdin/literal; 4 formatter cases), and the failing CLI diff shows "+ " / "Received + 1" (one extra blank line). That matches do's red count 46/10. Restored; the scratch worktree is removed.
- Done when ("add with a newline-terminated description changes TODO.md by the item line only") — covered by the same tests, with the literal (--description "Body\n") variant included.

Class check beyond the tests (CLI probes in a temp list under the attempt dir, HOME/TODO_MD_HOME isolated): `add --inline` with stdin "Body\n\nMore\n" adds exactly the 4 item lines (head, Body, blank, More); `edit 1 --description -` with "X\n\nY\n\n" then `promote 1` leaves TODO.md differing from the original by the link line only; `promote 3` of the inline add restores the original spacing. Inputs I didn't try: CRLF descriptions ("Body\r\n" keeps "Body\r", which predates this change and is out of scope), and leading blank lines (not part of this bug).

Comments: the task file todo/later/59-*.md has 23 lines and no `##` headings (grep -n '^## ' returned nothing), so it has no Comments section, and the brief has no pre-start comments. 0 comments, no authors.
Implementer's stated gaps: none stated. They didn't run the full gate (by instruction); check#1 ran it.
Orchestrator commits: the branch has only 3fdda96 (implementer's fix commit); no orchestrator bookkeeping commits on this branch to check.

Check: check.command `bun run check` passed on 3fdda96 (gate output 01M5GNJMNXD16TVK5N35QDF063: 1511 tests, 0 fail). Linter: "Found 0 warnings and 0 errors." in that recorded output, so 0 warnings and no increment is possible. I couldn't measure the base locally: oxlint failed to load ./lint/style.js while the scratch worktree existed, which is an environment problem, not this diff.
Scale: a trailing-pop loop over description lines, linear in its length, with no extra I/O. Nothing to measure.
Spec: docs/spec.md has no trailing-newline/description policy text (rg -i 'trailing (blank|newline)|final newline' docs/spec.md: no hits); §2.10 minimal diffs is now honoured. Renamed test "writes what was piped in byte for byte" → new name: rg 'byte for byte' over the repo returns nothing, so no stale reference.
Quality nit (no change needed): the new README sentence's first line runs past the paragraph's ~80-column wrap.

