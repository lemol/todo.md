---
title: An unresolved YAML alias in frontmatter crashes every read
tags: [bug, markdown]
group: Later
completed_at: 2026-10-22T03:58:14Z
outcome: completed
---
Found by the controller's post-land review of todo-md:64 (landed `d8f93e1`), while fuzzing the frontmatter reader and writer. It predates 64: `doc.toJS()` has read frontmatter since `03df9fa`.

**Cause.** `readFrontmatter` (`src/markdown/frontmatter.ts`) checks `doc.errors` and then calls `doc.toJS()`. The `yaml` library parses an alias to a missing anchor (`x: *a`) without an error, and throws from `toJS()` instead (`node_modules/yaml/dist/nodes/Alias.js`: "Unresolved alias (the anchor must be set before the alias)"; the same method throws "Excessive alias count indicates a resource exhaustion attack"). `parseTaskFile` says "Never fails", and spec §2.6 says invalid frontmatter is an `invalid-frontmatter` diagnostic, but the exception escapes it.

Evidence (scratch list at `d8f93e1`: `TODO.md` with `[1 - Bad](./later/1-bad.md)` and `[2 - Good](./later/2-good.md)`; `later/1-bad.md` is `---\ntitle: Bad\nx: *a\n---\nBody\n`; own `HOME` and `TODO_MD_HOME`):

- `todo list`, `todo check` and `todo show 2` each exit 1 with `ReferenceError: Unresolved alias (the anchor must be set before the alias): a`, thrown from `readFrontmatter` via `parseTaskFile` (`src/fs/parsing.ts`) and `src/fs/snapshot.ts`. One bad file makes the whole list unreadable, including `check`, the command meant to report it.
- `parseTaskFile`, `updateTaskFile` and `parseTodoFile` throw the same error on frontmatter `x: *a`.

#### What to build

1. `readFrontmatter` turns any throw from `toJS()` into its `error`, so callers report `invalid-frontmatter` (the message's first line, as for parse errors).
2. `frontmatterEdits` must not throw on the same text: treat it as YAML that does not parse (the existing whole-frontmatter fallback), or leave the frontmatter as it is. Say which in the README's Frontmatter bullet.
3. Bump `taskFileParserVersion` only if a parse the cache can hold changes. A throw was never cached, so it likely does not.

#### Tests first

- `parseTaskFile` on `"---\ntitle: T\nx: *a\n---\nBody\n"` does not throw and reports one `invalid-frontmatter` diagnostic.
- `parseTodoFile` on a `TODO.md` whose frontmatter is `x: *a` does not throw and reports `invalid-frontmatter`.
- `updateTaskFile` on the task file above with `{ assignee: "y" }` does not throw.
- An alias to an anchor that exists (`a: &x 1\nb: *x`) still reads `b` as `1`.

#### Done when

No frontmatter text makes `parseTaskFile` or `parseTodoFile` throw, and `todo check` on the list above reports the bad file instead of exiting with a stack trace.

#### Out of scope

The hub registry's own YAML (`src/hub/registry.ts`), which reads with `doc.get`, not `toJS()`.

## Comments

### @agent at 2026-10-22 03:58:14 +00:00

Done: Review finding F1 fixed: frontmatterEdits no longer drops keys when frontmatter with an unresolvable alias is a flow map or other non-block-map shape.

Change (commit a65fce5, on top of 9b5c5d4 + 48f171a):
- src/markdown/frontmatter.ts: inside the whole-frontmatter fallback branch, when doc.errors is empty but readFrontmatter reported an error (i.e. toJS() threw on unresolved aliases / alias bomb), return [] so the frontmatter is left as it is. Parse-error fallback (x: [) is untouched. Block maps with unresolved aliases keep the per-key splice path from 48f171a.
- JSDoc now reads "When aliases do not resolve in a block map, requested keys are spliced and other lines kept; otherwise the frontmatter is left as it is."
- src/markdown/README.md Frontmatter bullet qualified the same way: block-map edits splice only changed keys, any other shape is left unchanged.
- test/markdown/frontmatter.test.ts: new test "leaves flow-map frontmatter whose aliases do not resolve as it is" asserting frontmatterEdits("{title: T, x: *a}", {assignee: "y"}) is [].

Test-first evidence:
- After adding the test before the fix: bun test test/markdown/frontmatter.test.ts -> 17 pass, 1 fail (the new test; received [{start:0, deleteCount:1, lines:["assignee: y"]}]).
- After the fix: same file -> 18 pass, 0 fail.
- Reproduced the reported data loss directly: frontmatterEdits("{title: T, x: *a}", {assignee:"y"}) returned the whole-rebuild edit and updateTaskFile("---\n{title: Bad, x: *a}\n---\nBody\n", {assignee:"y"}) returned "---\nassignee: y\n---\nBody". After the fix both leave the source unchanged; block-map "title: T\nx: *a" still splices assignee correctly.
- Verified other toJS-throw shapes also return []: "- *a" and "*a" (sequence / scalar alias).
- Focused suites: bun test test/markdown/frontmatter.test.ts test/markdown/taskFile.test.ts test/markdown/todoFile.test.ts test/cli/query.test.ts test/fs/parsing.test.ts -> 106 pass, 0 fail.
- bun run lint -> clean (oxfmt + oxlint). bun run typecheck -> clean (tsc). Ran as separate commands. git diff --check clean, working tree clean after commit.
- Focused-test search for report: grep -rln "readFrontmatter|frontmatterEdits|invalid-frontmatter|taskFileParserVersion" src test finds src/markdown/{todoFile,frontmatter,taskFile}.ts, src/fs/{README,parsing}.ts, test/markdown/{taskFile,todoFile,frontmatter}.test.ts, test/cli/query.test.ts. Ran the markdown + query + fs/parsing suites above; no shared harness changed.
- Parser version stays 4; no src/fs change. Did not run bun run check or the full suite, per instructions; the check stage owns those. No other checkout or shared install touched. No orchestrator-output parser changed, so recorded-output corpus sampling inapplicable. No acceptance gaps.

Review: approved (4/5)
Review round 3: approved. Read the whole d6e861d..265fc5b diff, not just the last fix. No new findings. Earlier F1 and F2 are both fixed.

Comments checked: read the brief (no Pre-start task comments) and the entire todo/later/65-an-unresolved-yaml-alias-in-frontmatter-crashes-every-read.md. The task file has no Comments section. Count: 0; authors: none. No comment requirements are missing.

Earlier findings
- F1: FIXED. frontmatterEdits leaves unresolved flow-map, sequence and scalar-alias frontmatter unchanged. Current probes: "{title: T, x: *a}", "- *a", "*a" all return []. Block maps still splice requested keys.
- F2: FIXED by 265fc5b. src/markdown/frontmatter.ts:104 distinguishes the ordinary not-a-mapping error from a toJS throw. "- a\n- b" and "hello" again produce whole replacements, as at base; they no longer silently ignore the edit. The README indentation nit is fixed too.

Required cases and their pins (all run)
- parseTaskFile on the supplied title:T/x:*a source: test/markdown/taskFile.test.ts, "frontmatter aliases > an alias to a missing anchor is invalid frontmatter". Exact diagnostic array asserts one invalid-frontmatter, library message, line 1; description remains Body. It fails on an exception, missing/extra diagnostic, wrong code/message/line, or lost body.
- parseTodoFile with x:*a: test/markdown/todoFile.test.ts, "reports an alias to a missing anchor and keeps the defaults". Fails on a throw, wrong diagnostic array, or changed defaults.
- updateTaskFile with assignee:y: taskFile.test.ts, "an edit splices only the changed key". Exact source assertion catches a throw, lost title/alias/body, or wrong assignee. Also reversed its sole expected literal from assignee:y to assignee:z in scratch: 0 pass, 1 fail, received assignee:y. Restored afterward.
- Resolving a:&x 1 / b:*x: taskFile.test.ts, "an alias to an anchor that exists still reads", checks no diagnostics and extra {a:1,b:1}; frontmatter.test.ts also checks the reader directly. Wrong b or rejecting a valid alias fails these.
- Done when, todo check on the Bad/Good list: test/cli/query.test.ts, "reports a task file whose frontmatter alias does not resolve". Ran successfully; asserts exit 1, the invalid-frontmatter line, exactly 1 error and empty stderr. Fixture has precisely one invalid file and one valid file, so that total is correct. This is a diagnostic exit, not a stack trace.
- Nonthrowing parsers: additionally probed both public parsers on flow-map, sequence, scalar alias, nested alias, alias-as-key, merge-key, lone-CR, syntax-error, ordinary sequence/scalar, valid anchor and recursive anchor inputs. No throws. Alias-bomb coverage is frontmatter.test.ts "reports an alias bomb"; it runs and passes. This is example/class coverage, not a property generator or a proof over all possible strings.

What to build
1. DONE: readFrontmatter catches doc.toJS() in frontmatter.ts:45-49, returns empty data and textLines(message)[0]. Both callers convert the error into invalid-frontmatter (taskFile.ts:115; todoFile.ts:85). The catch is generic, not specific to ReferenceError.
2. DONE: block-map aliases retain unrelated lines and splice requested keys, including deletion; other unresolved shapes return no edits. README Frontmatter bullet documents that deliberate choice. frontmatter.test.ts "splices keys of YAML whose aliases do not resolve, leaving the other lines" pins deletion plus append; "leaves flow-map frontmatter whose aliases do not resolve as it is" pins preservation. The fallback for ordinary non-mappings and parse errors is preserved. The plan's block-map decision was qualified for other shapes in response to F1, with a stated data-preservation reason.
3. DONE: taskFileParserVersion remains 4 (taskFile.ts:103). Inspected fs/parsing.ts:216-225: parseTaskFile must return before used.set; an exception was never cached. Only formerly throwing parses change. No fs or hub diff.

Regression evidence, in a detached scratch worktree beneath this worktree (now removed)
- Replaced only frontmatter.ts with base d6e861d and ran frontmatter/taskFile/todoFile/query suites: 91 pass, 8 fail. Failures include both parsers, updateTaskFile, alias-bomb reader, writer preservation and CLI check. Resolving-anchor task test still passes.
- With 48f171a frontmatter.ts, current frontmatter suite: 18 pass, 1 fail; flow-map preservation test receives a destructive replacement instead of []. This proves the F1 pin detects the old bug.
- With a65fce5 frontmatter.ts: 18 pass, 1 fail; non-mapping replacement test receives [] rather than its two-line replacement. This proves the F2 pin detects the over-broad guard.

Class/external-library checks
Ran a direct bun probe against the installed yaml parseDocument(...).toJS(), alongside readFrontmatter, both parsers, frontmatterEdits and updateTaskFile. Raw unresolved flow-map/sequence/scalar/nested/key/merge inputs print "Unresolved alias (the anchor must be set before the alias): a"; the wrapped readers print invalid-frontmatter instead and the writer preserves or splices according to shape. Plain sequence/scalar toJS succeeds and the writer replaces them. Valid anchors and a recursive anchor parse without diagnostics. A malformed lone-CR example takes the pre-existing parse-error fallback. Deliberately did not inject custom tag handlers: these functions expose no custom-tag configuration; the changed catch handles arbitrary toJS throws. No orchestrator-output parser changed, so recorded orchestrator-output corpus checks are inapplicable.

Cost and consistency
Measured with bun -e: 100 frontmatterEdits calls on an unresolved block map with 1,001 keys took 2030.0 ms (about 20.3 ms/edit on this machine). No new I/O or extra parse pass was introduced: the writer already parsed and called readFrontmatter. Both work synchronously over the same immutable string, so the two parses cannot observe a file moving between them. A subsequent call retries independently; catching the library error introduces no mutable error state.

Verification and gaps
- Fresh focused command: bun test test/markdown/frontmatter.test.ts test/markdown/taskFile.test.ts test/markdown/todoFile.test.ts test/cli/query.test.ts test/fs/parsing.test.ts -> 107 pass, 0 fail.
- bun run typecheck -> exit 0. bun run lint -> exit 0 after removing scratch. An initial lint while the nested scratch checkout existed failed because oxlint discovered duplicate local plugin configurations; rerunning after scratch removal succeeded. No branch fix was needed.
- git diff --check d6e861d..HEAD clean; working tree clean.
- The plan's named focused-test, lint, typecheck and cache-test checks were observed passing, not merely predicted. Its historical 212-test scratch result is dated evidence, not a claim about this run's five-file selection.
- check.command is bun run check, not todo check. Did not rerun the whole gate. Read the recorded check#3 gate at 265fc5b: bun run lint && bun run typecheck && bun run test, 1571 tests, 0 fail. Linter says "Found 0 warnings and 0 errors." Base lint was not separately measured; there are no warning classes or positive increments to attribute.
- Implementer states "No acceptance gaps"; no named-test or Done-when gap remains. The omitted whole-gate run belongs to check and its recorded result is available.

Scope/commit audit
Checked every listed commit against its rule: 9b5c5d4 handles reader throws; 48f171a handles per-key edits/deletion; a65fce5 addresses F1; 265fc5b addresses F2 and the README nit. All are task/review fixes; no unrelated orchestrator housekeeping commit appears. No modules, directories, configuration fields, commands, events or intents are introduced. Existing tests remain in the repository's test/markdown and test/cli layout.

Whole-tree hidden-inclusive literal search was first validated against the base source. "frontmatter must be a mapping" occurs in the live constant (frontmatter.ts:30), the live reader test (frontmatter.test.ts:51), and the historical 2026-09-12 markdown-module plan (:771 and :847); all remain accurate. notMapping occurs only at the declaration, reader return and writer guard. No literal/version change requires a documentation migration.

Overall score 4 reflects the two earlier implementation misses; the final reviewed code satisfies the task with both regression fixes pinned. No open findings.


Citations that do not open (the verdict stands; a finding may still be right):
- `fs/parsing.ts:216-225` path does not exist
