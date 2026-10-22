---
title: Editing a CRLF task file's frontmatter writes a stray carriage return
tags: [bug, markdown]
group: Later
completed_at: 2026-10-22T02:44:29Z
outcome: completed
---
Named by todo-md:61's planner and implementer as out of scope, reproduced by the controller on `6af1afe` (61's landing) with a scratch script calling `updateTaskFile` from `src/markdown/taskFile.ts`:

- `updateTaskFile("---\r\ntitle: T\r\ntags: [a]\r\n---\r\nBody\r\n", { tags: ["b"] })` gives `"---\r\ntitle: T\r\r\ntags: [b]\r\n---\r\nBody\r\n"`: the unchanged `title` line gains a `\r` before its `\r\n`.
- `updateTaskFile(…, { title: "U" })` on `"---\r\ntitle: T\r\n---\r\nBody\r\n"` gives a clean `"---\r\ntitle: U\r\n---\r\nBody\r\n"`: the stray `\r` lands on the lines a changed key does not rewrite, when another key follows.

Path: `updateTaskFile` passes the mdast yaml node's `value` (which keeps the file's `\r\n`) to `setFrontmatterFields` (`src/markdown/frontmatter.ts`), which splits it on `"\n"` only (`yaml.split("\n")` and `lineOf`), so each kept line still ends in `\r`; `joinLines` then adds the file's `\r\n`. Confirm the path before fixing. Any `todo edit`, `tag`, `done` or other frontmatter write on a CRLF task file corrupts it this way, which 61's rule ("text that becomes lines never carries a `\r` in", `src/markdown/README.md`) says must not happen.

#### What to build

1. Frontmatter lines kept by `setFrontmatterFields` carry no `\r`: split the YAML on every line ending (`textLines` in `src/markdown/lines.ts`), at whichever boundary keeps `lineOf`'s offsets and the `yaml` library's ranges in agreement.
2. If `readFrontmatter`'s YAML-error message path (`first.message.split("\n")`) can carry a `\r` into a diagnostic, fix it the same way; otherwise say why not in the report.

#### Tests first

- `updateTaskFile` on a CRLF task file with two or more frontmatter keys: changing one key leaves every other line byte-for-byte and the whole file CRLF. Red before the fix.
- The same for deleting a key (`undefined`) and for appending a new key.
- A CLI test: a CRLF task file, `todo edit <id> --tag b`, and the file stays all CRLF with only the changed line differing.

#### Done when

No frontmatter write on a CRLF task file leaves a `\r` before a line ending.

#### Out of scope

Lone-CR (`\r`-only) files: `splitLines` does not treat a lone CR as a line ending, a pre-existing behavior 61 left alone.

## Comments

### @nzila at 2026-10-22 02:44:29 +00:00

Done: fix(markdown): preserve CRLF frontmatter lines during edits (1ee7a07 on nzila/01M5GQBC812V17ZGK5JA1NC78H).

Path confirmed before fixing: `updateTaskFile` passes the mdast yaml node's `value` (raw, keeps `\r\n`) into `setFrontmatterFields`, which split on `"\n"` only, so kept lines ended in `\r` and `joinLines` added the file's `\r\n` on top — reproduced exactly as the task describes, and the 6 new tests failed red at base (130 pass / 6 fail, matching the plan's known-bad run).

What was built (per plan, no deviations):
- `src/markdown/frontmatter.ts`: `setFrontmatterFields` now builds kept lines with `textLines(yaml)` and parses/slices a single LF-normalized source (`textLines(yaml).join("\n")`) for `parseDocument`, `readFrontmatter` and `lineOf`, keeping ranges and offsets in one coordinate system. `readFrontmatter`'s YAML-error first line now uses `textLines(first.message)[0]` — the `\r`-bearing diagnostic was reachable (plan's observed `Invalid escape sequence \\` + raw CR case), so it was fixed, not declined.
- `src/markdown/taskFile.ts`: `taskFileParserVersion` 1 → 2 (changed diagnostics change cached parses).
- `src/markdown/README.md`: line-ending rule examples extended to frontmatter kept lines and YAML-error text.
- Tests: 3 `updateTaskFile` CRLF tests (change/delete/append, exact whole-file equality), 1 `setFrontmatterFields` multiline-CRLF range-alignment test, 1 `readFrontmatter` diagnostic test, 1 CLI test (`todo edit 1 --tag b` on a CRLF `01-t.md`, whole file stays CRLF with only the tags line differing).

Verification (all in the worktree; TMPDIR kept under the attempt dir):
- Red: focused 6-file suite failed exactly the 6 new tests at base; green after fix: 136 pass, 0 fail (`bun test test/markdown/frontmatter.test.ts test/markdown/taskFile.test.ts test/markdown/lines.test.ts test/markdown/todoFile.test.ts test/fs/parsing.test.ts test/cli/tasks.test.ts`).
- Repro script post-fix: `updateTaskFile("---\r\ntitle: T\r\ntags: [a]\r\n---\r\nBody\r\n", {tags:["b"]})` → `"---\r\ntitle: T\r\ntags: [b]\r\n---\r\nBody\r\n"`, no stray `\r`.
- `bun run lint` exit 0 (oxfmt clean after one formatting pass on the new tests; oxlint silent pass), `bun run typecheck` exit 0 — run as separate commands, each to completion. Whole gate (`bun run check`) deliberately not run: owned by the check stage per instructions.
- Searches run and reported: `rg` for `CRLF|edit|--tag|sandbox|spawn`, for `2.10|line ending|split("\n")|setFrontmatterFields|textLines`, and for `taskFileParserVersion|invalid-frontmatter|readFrontmatter`. Findings: `setFrontmatterFields` has a single consumer (`updateTaskFile`); `todoFile.ts` also calls `readFrontmatter` on mdast yaml so it inherits the diagnostic fix; the `test/fs/parsing.test.ts:172` `{"version":1}` fixture still passes as-is (stale-version files decode-fail and the prune assertions only read the root header), so it was left untouched.

Notes: read the installed Effect AGENTS.md in full before the Effect-based CLI test edit (resolved upward; worktree has no node_modules). No installs, no probe symlinks, no scratch worktrees left; commit `1ee7a07`, worktree clean. No gaps: every Done-when item verified; no review notes were carried in the brief.

Review: approved (5/5)
Approved. Reviewed the whole diff 0fef681..1ee7a07 (one commit: src/markdown/frontmatter.ts, taskFile.ts, README.md, plus three test files).

Path confirmed: `taskFile.ts:340` `setFrontmatterFields(yaml.value, fields)` passes the raw yaml. At base, `yaml.split("\n")` kept a `\r` on every line, and `joinLines` then added the file's eol. Reverting only frontmatter.ts in a scratch worktree turns all 6 new tests red (output below).

What to build:
1. Done. In `setFrontmatterFields`, `lines = textLines(yaml)` and `normalized = textLines(yaml).join("\n")` feed `parseDocument`, `readFrontmatter` and `lineOf`, so the yaml library's ranges and the line indices share one coordinate system.
2. Done. `readFrontmatter` uses `textLines(first.message)[0]`. The case can happen: `parseTaskFile("---\r\na: \"\\\rX\"\r\nb: 1\r\n---\r\n")` gives message `"Invalid escape sequence \\"` with no CR, line 1. `taskFileParserVersion` 1→2 because diagnostics change. Its uses are `src/fs/parsing.ts:19,84,176` (live, they read the constant); `src/fs/README.md:49` and `docs/architecture/storage.md:79` name the rule, not the value; todo/done/47 and docs/dogfooding/runs/47 are dated history.

Tests and Done-when, each pinned:
- Change one key on a CRLF file with several keys: `updateTaskFile > changing a key preserves other CRLF lines`. It compares the whole file with toBe, so it fails on any byte other than the tags line, including a stray `\r` on `title: T   # keep`.
- Delete a key: `deleting a key preserves other CRLF lines`. It passes `tags: []`, which `updateTaskFile` maps to `fields.tags = undefined` (taskFile.ts:308), so it covers the undefined path.
- Append a key: `appending a key preserves other CRLF lines` (assignee).
- CLI: `todo edit > todo edit --tag preserves CRLF task frontmatter` compares the whole file, so only the tags line may differ.
- Diagnostic: `readFrontmatter > diagnostics stop at every line ending`.
- Multiline CRLF: `setFrontmatterFields > keeps YAML ranges aligned after a multiline CRLF value`.

Reversals in scratch worktree .nzila-scratch-$NZILA_ATTEMPT (removed afterwards; status clean):
(a) base frontmatter.ts: 6 fail / 90 pass. The 6 failures are exactly the new tests.
(b) only the message split reverted: 1 fail (`diagnostics stop at every line ending`).
(c) parseDocument and lineOf on raw `yaml` while keeping `textLines` lines: 0 fail.

Observation (c), non-blocking: for CRLF, counting `\n` in raw text gives the same line indices as the normalized text, so the normalized parse source only matters for lone-CR input, which is out of scope. The multiline test checks that kept lines carry no `\r`, but it does not check the coordinate choice. No change required.

Class probe with updateTaskFile, all outputs all-CRLF with no `\r\r`:
- block scalar `title: |` then change tags, then change title
- block-sequence tags with a comment line
- delete a block sequence
- append on a file with no body
- two appended keys
- flow-map frontmatter (rewritten, same as base behavior)
- invalid YAML (reformatted, same as base)
A mixed file whose majority is LF comes out all LF, as the README rule says.
Not tried on purpose: lone-CR files (out of scope). Note: with normalization, a lone CR inside a quoted value now parses as a line break in `current` (yaml lib raw gives "a\rb"), which matches the README's "lone CR" wording.

Comments: the task file todo/later/62-editing-a-crlf-task-file-s-frontmatter-writes-a-stray.md has no Comments section (`grep -n Comments` returned nothing), so 0 comments and no authors. The brief has no pre-start comments. Implementer's gaps: none stated.

Commit check: one nzila commit, 1ee7a07 fix(markdown). It is in scope for the task and its message matches the change.

Spec: docs/spec.md:231 says "Writers preserve the line ending style of existing files". The code now honors that. The README rule extension is accurate.

Check: check.command `bun run check` passed on 1ee7a07: 1537 tests across 107 files. Lint: "Found 0 warnings and 0 errors." (gate output.log line 8), base 0. Focused suite rerun: 136 pass, 0 fail across 6 files.

Cost: setFrontmatterFields now calls textLines twice on the frontmatter. That is linear and bounded by frontmatter size, so no measurement is needed.

No new config, commands or modules.

Branch: nzila/01M5GQBC812V17ZGK5JA1NC78H

nzila run 01M5GQBC812V17ZGK5JA1NC78H
