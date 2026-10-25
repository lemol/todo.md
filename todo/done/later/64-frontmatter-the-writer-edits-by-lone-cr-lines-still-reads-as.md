---
title: Frontmatter the writer edits by lone-CR lines still reads as invalid
tags: [bug, markdown]
group: Later
completed_at: 2026-10-22T03:23:23Z
outcome: completed
---
Found by the controller's post-land review of todo-md:63 (landed `57a5cc6`), probing the class of YAML 63's writer fallback handles.

**Cause.** 63's `frontmatterEdits` (`src/markdown/frontmatter.ts`) parses the raw YAML first and, when that has errors, reads it again with lone CRs as line breaks (`textLines(yaml).join("\n")`), then edits it by those lines. The README records this ("YAML which only parses with lone CRs as line breaks is edited by those lines"). The reader did not change: `readFrontmatter` parses only the raw YAML, so `parseTaskFile` reports `invalid-frontmatter` for the same text. The writer edits frontmatter the reader cannot see, so an edit reports success and reading back shows nothing.

Evidence (scratch script importing `src/markdown/taskFile.ts` at `57a5cc6`):

- `parseTaskFile("---\ntitle: T\rassignee: z\n---\nBody\n", "x.md")` gives title `null`, assignee `null`, and an `invalid-frontmatter` error ("Nested mappings are not allowed in compact mappings at line 1, column 8").
- `updateTaskFile` on that text with `{ assignee: "y" }` gives `"---\ntitle: T\rassignee: y\n---\nBody\n"`: the writer read `assignee: z` as a key and rewrote it.
- Parsing that result still gives title `null`, assignee `null` and the same error. So `todo assign` succeeds while `todo show` shows no title or assignee.
- `parseTaskFile("---\ntitle: T\rtags: [a]\n---\nBody\n", "x.md")` gives title `null`, tags `[]`, while 63's own test ("changing a key in `---\ntitle: T\rtags: [a]\n---\nBody\n` keeps every other line") edits `tags` as a key.

No data is lost, so this is less severe than 63. It breaks 63's aim that one line model holds across the parser and the writers.

#### What to build

1. Make `readFrontmatter` use the same fallback as `frontmatterEdits`: parse the raw YAML, and only when that has errors, parse it with lone CRs as line breaks. Report `invalid-frontmatter` only when both fail. Share one helper so the two cannot drift.
2. Bump `taskFileParserVersion` (`src/markdown/taskFile.ts`), because `src/fs/parsing.ts` caches parses by it and these files now parse differently.
3. Update `src/markdown/README.md`'s Frontmatter bullet so it says the reader and the writer read such YAML the same way.

#### Tests first

- `parseTaskFile` on `"---\ntitle: T\rtags: [a]\n---\nBody\n"` gives title `T`, tags `["a"]` and no diagnostics, on LF and CRLF files.
- Round trip: `updateTaskFile` with `{ assignee: "y" }` on `"---\ntitle: T\rassignee: z\n---\nBody\n"`, then `parseTaskFile`, gives title `T` and assignee `y`.
- Raw-valid YAML with a lone CR inside a quoted value (`title: "a\rb"`) still reads as the raw parse does: title `"a\rb"`.
- YAML that fails both ways still reports `invalid-frontmatter`.

#### Done when

Every task file whose frontmatter `frontmatterEdits` edits by keys reads back through `parseTaskFile` with those keys.

#### Out of scope

The invalid-YAML fallback that rewrites the whole frontmatter from what parsed (a pre-63 policy).

## Comments

### @agent at 2026-10-22 03:23:23 +00:00

Done: Added a shared `parseYaml` helper in `src/markdown/frontmatter.ts`. It parses the raw YAML first and falls back to lone-CR-as-line-break text only when the raw parse has errors. `readFrontmatter` and `frontmatterEdits` both use it, so the reader and writer can't drift. If both parses fail, the raw error is reported.

Other changes:
- Bumped `taskFileParserVersion` from 3 to 4.
- Updated the Frontmatter bullet in `src/markdown/README.md`.
- Added four tests in `test/markdown/taskFile.test.ts`:
  - LF and CRLF read of `title: T\rtags: [a]`.
  - Round trip of `updateTaskFile` then `parseTaskFile`.
  - Raw-valid `"a\rb"` stays content.
  - Invalid both ways still gives `invalid-frontmatter`.

Verification:
- Reverted `src/` and ran `test/markdown/taskFile.test.ts`: the three new reader/round-trip tests failed. The other two, raw-valid and invalid-both-ways, pass at the base by design.
- With the change: `bun test test/markdown test/fs` gives 425 pass, 0 fail.
- Lint and typecheck were each run on their own and both pass.
- I did not run `bun run check`, as instructed.
- I searched `test/` for `parserVersion` and found no test that pins the version number.

Review: approved (5/5)
Approved. Reviewed the entire 04c46dd..380e224 diff (all four files), not just the implementation summary. No blocking findings. Branch left unchanged; detached scratch worktree removed.

Requirements:
1. Done: src/markdown/frontmatter.ts, parseYaml. Raw parse wins when error-free; only an erroneous raw parse is retried using textLines. Both readFrontmatter and frontmatterEdits use it. When both fail the original diagnostic survives. The writer's whole-frontmatter fallback remains available; no redesign of that policy.
2. Done: src/markdown/taskFile.ts:103 changes taskFileParserVersion from 3 to 4. src/fs/parsing.ts:84 decodes using Schema.Literal(taskFileParserVersion), :176 writes that version, and :221 reparses misses. Existing cached version-3 parses therefore cannot mask the new interpretation.
3. Done: src/markdown/README.md, Frontmatter bullet explicitly describes reader/writer agreement.

Required tests, all in test/markdown/taskFile.test.ts under “frontmatter read with lone CRs as line breaks”:
- LF and CRLF: “reads keys the raw YAML cannot parse (%s)” (:541), two cases. Would fail on any diagnostic, title other than T, or tags other than [a].
- Update/read round trip: “an edit reads back through the parser” (:549). Would fail on a diagnostic, title other than T, or assignee other than y.
- Raw-valid quoted CR: “raw-valid YAML keeps a lone CR as content” (:558). Would fail if title lost/normalized the literal CR.
- Both parses invalid: “YAML that fails both ways is invalid” (:562). Would fail if diagnostic codes were anything other than exactly [invalid-frontmatter].
- Done-when agreement: shared helper establishes identical YAML selection; round-trip test pins its effect at the public task-file boundary. Existing writer preservation tests also pass. These are example tests, not generated properties.

Test strength verified, not inferred: in a detached scratch worktree I reversed both single-expect tests above with .not; the filtered run produced 3 pass / 2 fail at the reversed assertions. Restoring those tests and replacing src with the base produced 2 pass / 3 fail: both line-ending reader cases and the round-trip case fail with invalid-frontmatter. Thus the new tests catch the original bug. Restored implementation passes.

Additional class checks: ran a Bun probe importing the actual YAML library plus readFrontmatter, parseTaskFile, updateTaskFile and parseTodoFile. Inputs included multiple CR-separated keys, quoted key names, trailing comments, nested unknown mappings, flow mappings, raw-valid quoted CR content, and malformed flow syntax. All supported cases edited assignee to y and read back title/assignee and nested extras without diagnostics. The malformed case retained the original read error and followed the existing whole-frontmatter writer fallback. The shared TODO.md reader was exercised with tasks_dir: tasks\rdone_dir: archive; output was {tasksDir:"tasks",doneDir:"archive"}, diagnostics []. No network events, retries or external-record protocol is involved; the probe directly exercises the YAML parser's actual response. Arbitrary invalid field types and exhaustive YAML syntax were not enumerated: semantic field validation is unchanged, and the targeted markdown/fs suites cover existing contracts.

Repeated reads: writer still parses for source ranges and again through readFrontmatter for values. Both operate on the same immutable string synchronously, so no moving-file or crash window is introduced. Cost probe: bun -e loop over parseTaskFile after 100 warmups, 10,000 calls each: ordinary raw-valid input 1207.8 ms; fallback input 818.8 ms. These are observed separate timings, not a speedup claim; fallback adds at most one YAML parse per helper invocation. No new module or directory; tests remain in the repository's mirrored test/markdown layout.

Comments: read the brief (no Pre-start task comments section) and the complete current todo/later/64-frontmatter-the-writer-edits-by-lone-cr-lines-still-reads-as.md (ends at Out of scope, no Comments section). Count 0; authors none. No comment requirements to disposition.

Implementer gaps: not running the whole gate is done by check#1: check.command is bun run check, check.passed=380e224, 1561 tests / 107 files. I did not rerun the whole gate. Lack of a literal version-number test is pushed back as unnecessary here: the actual bump and schema consumer were inspected, and cache tests pass; pinning a constant would not prove reader behavior. No other stated gaps or separate plan/Decision requirements were supplied. Sole listed commit 380e224 matches the task's reader-fallback, parser-version and documentation rules; no unrelated orchestrator commit.

Verification observed here: bun test test/markdown test/fs: 425 pass, 0 fail, 757 expects, 25 files (matches the implementer's 425/0 claim). bun run typecheck passed. bun run lint passed after scratch removal. A first lint while the nested scratch existed hit duplicate local-plugin registration; removing scratch resolved it without branch changes. Gate log records 0 warnings / 0 errors (no warning class). Base scratch lint also exited 0 with no warning diagnostics; its output did not print a warning-count line, so no numeric baseline warning count is inferred. Current lint likewise exited 0 without a warnings line. Full gate log explicitly shows lint, typecheck and tests, so its passed command is bun run check, not merely my narrower test run.

Stale-reference checks: proved the search on base README (“CRs as line breaks” matched line 38), then searched the whole tree including hidden files, todo and docs. Current README is live and updated; the old wording in task 64's Cause is historical evidence at 57a5cc6. Version-value search found version 3 in todo/done/later/63 (lines 47,70) and docs/dogfooding/runs/63 (line 19): all historical task-63 records, not current configuration. Other matches were unrelated spec level-3 headings and a plan's Step 3. Live constant is 4; fs uses the constant rather than another literal. No specification conflict found: minimal-diff splicing and existing invalid-field diagnostics remain unchanged.

