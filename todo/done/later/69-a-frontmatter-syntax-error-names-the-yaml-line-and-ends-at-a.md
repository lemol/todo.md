---
title: A frontmatter syntax error names the YAML line and ends at a colon
tags: [bug, markdown]
group: Later
completed_at: 2026-10-22T05:17:13Z
outcome: completed
---
Found by the controller's post-land review of todo-md:66 (landed `1efcb60`). 66 made the reader's `invalid-frontmatter` message the error a failed write prints, so its two flaws now reach every `edit`, `done`, `cancel` and `reopen` on such a file, not only `todo check`.

Evidence (scratch list at `1efcb60`, own `HOME` and `TODO_MD_HOME`; `later/2-syn.md` = `---\ntitle: Syn\nx: [\n---\nBody\n`):

- `todo edit 2 --assignee y` prints `error: cannot edit later/2-syn.md: invalid-frontmatter: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 5:` and exits 1.
- "line 2" is the line inside the YAML; in the file it is line 3 (the opening fence is line 1). `todo check` reports the same message at `later/2-syn.md:1`, so the two positions it gives disagree with each other and with the file.
- The message ends at a colon: `readFrontmatter` (`src/markdown/frontmatter.ts`) keeps `textLines(first.message)[0]`, and `yaml`'s message continues with a code frame after that colon.

#### What to build

1. The `invalid-frontmatter` message for a YAML error gives the file's line and column (YAML line + 1 for the fence; use the error's `linePos`), or drops `yaml`'s "at line …" suffix and puts the position in the diagnostic's own line instead. State the choice.
2. The message does not end at a dangling colon.
3. `todo check`'s diagnostic line for a YAML syntax error points at the file line of the error, if (1) chose that.

#### Tests first

- `test/markdown/frontmatter.test.ts` or `taskFile.test.ts`: frontmatter `title: Syn\nx: [` gives a message with no trailing colon and, for the chosen form, the file position (line 3).
- `test/cli/frontmatter.test.ts`: the exact stderr of `todo edit` on that file changes to the new message.

#### Done when

A frontmatter syntax error's message and position name the file's line, the same in `todo check` and in a failed write.

#### Out of scope

The hub registry's messages (todo-md:68). Aliases and non-mappings, whose messages carry no position.

## Comments

### @agent at 2026-10-22 05:17:13 +00:00

Done: Commit 7f83761: a YAML frontmatter syntax error now reads `... end with a ] at line 3, column 5`. The line is the file's line and there is no trailing colon.

Choice: I kept the position in the message, in file coordinates. It is YAML's `linePos` plus 1 for the opening fence. The diagnostic line is the same number, so `todo check` and a failed `edit`, `done`, `cancel` or `reopen` agree.

Changes:
- `readFrontmatter` strips yaml's generated ` at line…, column…[:code frame]` suffix, keeps the first line, and appends file coordinates. It also returns a new optional `errorLine`, set only for YAML parser errors.
- Alias and non-mapping errors are unchanged. A parser error with no `linePos` gets a message with no trailing colon and no `errorLine`.
- `parseTaskFile` and `readConfig` in `todoFile.ts` use `errorLine ?? 1` for the diagnostic line. Other config errors still report line 1.
- `taskFileParserVersion` goes from 4 to 5, so cached version-4 diagnostics are discarded.
- A sentence in `src/markdown/README.md` documents the file-coordinate behaviour.

Tests were written first. Against the old code, 9 tests failed, all for the line/colon reasons. That covers the new tests plus the updated exact-message assertions.
- **New tests:**
  - `taskFile.test.ts`: LF and CRLF.
  - `cli/frontmatter.test.ts`: check, edit and reopen.
  - `fs/parsing.test.ts`: a version-4 cache entry is discarded and the file reparsed.
- **Updated assertions:** existing expected messages in `frontmatter.test.ts` (including the line-ending escape case), `cli/frontmatter.test.ts` and `fs/invalidFrontmatter.test.ts`.

Verification:
- Focused tests: 7 files (`test/markdown/{frontmatter,taskFile,todoFile}`, `test/fs/{invalidFrontmatter,parsing}`, `test/cli/{frontmatter,query}`), run with attempt-owned HOME, TODO_MD_HOME and TMPDIR. Result: 125 pass, 0 fail.
- `bun run lint`: the first run failed oxfmt on 4 test files I had added to. I ran oxfmt on them, and lint then passed with 0 warnings and 0 errors.
- `bun run typecheck` (run separately): exit 0.
- Search: `rg -n 'taskFileParserVersion|Flow sequence' src test` and the plan's `invalid-frontmatter|readFrontmatter` search. No assertions turned up beyond those I updated or the alias-only ones in `cli/query.test.ts` and `markdown/todoFile.test.ts`, which pass unchanged.
- Not run: `bun run check` and the full suite, as instructed.
- No `node_modules` probe link was created, so there is nothing to remove, and the shared install is untouched.

Review: approved (5/5)
review#1 visit 1: approved. Read the whole diff d0be73f..7f83761 (9 files) against the task and project rules. Worktree clean, no branch edits, scratch worktrees removed.

Choice stated (task item 1): keep the position in the message in file coordinates (yaml linePos line + 1 for the opening fence) and use the same number as the diagnostic line. Commit message, README sentence, and code agree.

What to build:
1. DONE. src/markdown/frontmatter.ts:44 strips yaml's generated " at line N, column M" suffix plus code frame, takes textLines(...)[0], and appends file coordinates from first.linePos (src/markdown/frontmatter.ts:45, src/markdown/frontmatter.ts:50-52). todo check and failed writes therefore agree.
2. DONE. No message ends at a dangling colon: parser errors get the rebuilt "at line L, column C" ending; the no-linePos branch strips a trailing colon (src/markdown/frontmatter.ts:47); toJS/alias and non-mapping branches keep their colon-free first lines unchanged.
3. DONE. parseTaskFile uses errorLine ?? 1 (src/markdown/taskFile.ts:113-115); readConfig passes errorLine with default 1 (src/todoFile.ts:82-87), so a YAML syntax error's diagnostic line is the file line; semantic/config errors stay at line 1 (probed tasks_dir bad path -> line 1).

Tests / Done when (each pinned or missing):
- Markdown message with no trailing colon + file position (line 3): PINNED. test/markdown/taskFile.test.ts:602-616 ("syntax errors use file coordinates", LF and CRLF) asserts readFrontmatter error equals the line-3 message, not matching /:$/, parseTaskFile diagnostic line 3, parseTodoFile diagnostic line 3, updateTaskFile fails with the message.
- Exact stderr of todo edit on that file: PINNED. test/cli/frontmatter.test.ts:55-82 ("check and edit agree") asserts check stdout "later/2-syn.md:3 ... at line 3, column 5" and edit stderr with the same message; test/cli/frontmatter.test.ts:84-103 pins reopen on a done file; describe.each at test/cli/frontmatter.test.ts:9-40 pins edit/done/cancel via the shared message variable.
- Done when (message and position name the file line, same in check and failed writes): PINNED by the above two plus test/fs/invalidFrontmatter.test.ts:16-22 (StoreError message) and test/fs/parsing.test.ts:212-240 (reparsed diagnostic line 3).
- Reversal (scratch detached worktree, reverted only frontmatter.ts to the old one-liner): new taskFile tests fail with Expected "at line 3, column 5" Received "at line 2, column 5:", 2 fail. The tests would have to see the old YAML-relative line plus trailing colon to fail; they pin the fix. Worktree removed afterwards.
- Quantities re-derived: base focused 120 pass (plan, observed) + 5 new (taskFile x2 via test.each, cli check/edit, cli reopen, parsing x1) = 125 pass. Reran focused 7 files with attempt-owned HOME/TMPDIR/TODO_MD_HOME: 125 pass, 0 fail. Matches the plan prediction (exit 0, 0 fail, count grows).

Comments: read the brief (no "Pre-start task comments" block present) and the task file todo/later/69-*.md at review time (30 lines, no "## Comments" section). Comment count 0, no authors. Nothing to walk; no comment missing.

Implementer's stated gaps: the do report states no gaps section; its "Not run: bun run check and full suite, as instructed" and "No node_modules probe link" are scope/hygiene notes, not gaps. No gap on a Done-when command or named test stays missing: focused tests reran here (125 pass), and check#1 ran the full gate.

Commits vs rule: one commit on the branch, 7f83761 "fix(markdown): report frontmatter syntax errors at file coordinates", exactly the plan's stated message and file list (src/markdown/{frontmatter,taskFile,todoFile}.ts, src/markdown/README.md, 5 test files). No commit outside its rule.

Check command: brief check.command is "bun run check". check#1 reported passed on 7f83761 (1601 tests across 109 files). That is the command named here; the focused bun test + bun run lint + bun run typecheck I ran are the change-touching checks, not the gate.

Fixture numbers checked against source, not code: md("---","title: Syn","x: [","---","Body") has file line 3 = "x: ["; yaml linePos line 2 col 5 + 1 = file line 3. "unclosed: [a, b" is one yaml line -> file line 2 col 16, as asserted. Escape input yields yaml line 1 col 5 -> file line 2 col 5 after CR-aware split. All consistent with yaml probes.

Constraints left out: none. Out-of-scope hub registry untouched (no hub files in diff; hub search shows no readFrontmatter/errorLine). Aliases/non-mappings unchanged and pinned (alias message identical in frontmatter.test.ts:27, taskFile.test.ts:574, cli/query.test.ts:195; non-mapping strings unchanged).

Cost at scale: no test measures it; measured here: 2000x readFrontmatter error-format = 156.1 ms total, ~0.078 ms/call, one regex strip + string append, no extra parse pass or I/O. Command and output recorded in the log.

Spec: docs/spec.md 2.6/2.10 do not fix message text or line numbers (only code invalid-frontmatter and minimal-diff/fail-closed behavior); no spec change needed and none made. README sentence matches code (verified by probes: file coordinates, fence counts as line 1, single line, no trailing colon).

Reads/crash: frontmatterEdits' double parse (parseYaml + readFrontmatter over the same immutable string) is pre-existing; failed writes stay atomic (tests assert disk.tree/read unchanged). Nothing is read across a long command or crash; cache reparse is synchronous and version-gated.

Migration: version 4->5 invalidates cached diagnostics. test/fs/parsing.test.ts:212-240 seeds version 4 with "stale syntax diagnostic", reparses, and asserts the derived message AND line 3 (not a version default). Rows never rewritten are still discarded on next read because src/fs/parsing.ts:84 requires Schema.Literal(taskFileParserVersion).

Predicate class (regex + colon-strip + errorLine guard): tried flow-sequence errors on yaml lines 1/2, first-line "x: [", later-line "a:1 b:2 c: [", tab indent, duplicate keys, nested mappings, escape with literal CR, lone-CR "title: Syn\rx: [", CRLF, value containing the phrase "at line 5, column 1", TODO.md config syntax error vs bad-path config error, alias and non-mapping inputs. All yield single-line colon-free messages with correct file lines (or unchanged alias/mapping messages). Deliberately did not try custom yaml tags (no custom-tag config exists on these entry points) or hub-registry strings (out of scope todo-md:68). The no-linePos branch (src/markdown/frontmatter.ts:47) is defensive: every yaml parser error probed carries linePos; toJS throws bypass it. No test pins that branch alone, acceptable.

External side (yaml library): read its real record via bun probes (message + linePos + code frame confirmed) and the plan's observed errors.js suffix/code-frame behavior. yaml always appends " at line N, column M" plus an optional ":<code frame>"; the strip regex handles both. No retry/second-event behavior applies (synchronous parse). Nothing left as an open question.

Modules: no new module/directory; markdown-internal changes only, so no colocated-test question. Boundaries test governs src only; test cross-imports (taskFile.test.ts importing todoFile) are outside it.

Value search: "taskFileParserVersion" live: src/markdown/taskFile.ts:103 (=5), src/fs/parsing.ts:19,84,176 (consumers, unchanged). Dated: test seed "saved.version = 4" (stale-fixture simulation, stays), historical 2->3 notes in todo/done files (history, stay). "at line 3, column 5" live in 5 test files (listed above); "at line 2, column 5:" remains only in the task file's Evidence section describing 1efcb60 (dated history, stays). No stale live copy.

Verification steps (plan): (1) tests-first 9 failures and post-fix 125 pass: observed per do report; my scratch reversal re-observed the known-bad signature. (2) searches: reran broader rg across src test todo docs .agents scripts; only expected hits plus alias-only assertions that pass unchanged. (3) focused command: base 120 pass per plan; reran head 125 pass. (4) known-bad probes: observed per plan; scratch reversal re-observed 2 fail. (5) lint + typecheck: predicted exit 0; observed both exit 0.

Linter: "0 warnings, 0 errors; base had 0" from "bun run lint" alone (oxfmt --check + oxlint), not the whole gate. Head and base both pass; no increment to attribute.

New field errorLine: edge is yaml linePos via readFrontmatter (src/markdown/frontmatter.ts:10,50-52) to parseTaskFile diagnostics and readConfig diagnostics; consumed by fs parsing/snapshot and surfaced by cli check/edit/done/cancel/reopen. No new CLI flag or config decode; producers are src, not tests-only.

No open findings.


Citations that do not open (the verdict stands; a finding may still be right):
- `src/todoFile.ts:82-87` path does not exist
- `later/2-syn.md:3` path does not exist
- `cli/query.test.ts:195` path does not exist
