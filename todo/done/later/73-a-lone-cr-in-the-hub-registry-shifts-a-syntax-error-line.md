---
title: A lone CR in the hub registry shifts a syntax error line
tags: [bug, hub]
group: Later
completed_at: 2026-10-22T07:21:43Z
outcome: completed
---
Found by the controller's post-land review of todo-md:71 (landed `bcf6fb3`, closed `8026792`). 71 keeps `yaml`'s own line in a registry syntax error, on the brief's ground that "the registry has no fence, so `yaml`'s line is the file's line". `yaml` counts lines by LF only. A lone CR is a line break both to YAML 1.2 (`b-break`) and to this repo's line model (`splitLines`), so each lone CR above the error moves the reported line one short. 72 fixes the same gap for frontmatter, but rules the registry out and names 71. 71 did not cover it, so the registry falls between the two tasks. The 71 reviewer's 17-input class probe tried CRLF but not a lone CR.

Evidence (probe at `8026792`, `parseDocument` as `read` calls it):

- `projects:\n  a: "x\ry"\n  b: [\n` gives `... end with a ] at line 4, column 1`. `splitLines` puts the end of `  b: [` on line 5.
- The same file without the `\r` gives line 3, which is correct.
- A registry that uses lone CR everywhere (`projects:\r  a: 1\r  b: [\r`) reads as one line: `Nested mappings are not allowed in compact mappings at line 1, column 10`.

#### What to build

1. Map the error's offset (`error.pos[0]`) to a line and column using LF, CRLF and lone CR as breaks, and put that in the message in place of `yaml`'s position. `hub` may not import `markdown` (`test/boundaries.test.ts`), so either use a local helper or move a shared one to a module both can import, and update the architecture doc and the boundaries test together. Or state why `yaml`'s line stays, and write the gap down in `src/hub/README.md`.
2. Read 72's outcome first, if it has landed, so the two messages agree.
3. A file that uses lone CR everywhere is out of reach here (`yaml` sees one line). Leave its message as it is.

#### Tests first

- `test/hub/registry.test.ts`, in 71's "syntax errors keep their file position without a dangling colon" loop: `projects:\n  a: "x\ry"\n  b: [\n` names line 5 in its exact message.

#### Done when

A registry syntax error below a lone CR names the line `splitLines` would put it on.

#### Out of scope

Frontmatter (72). How `yaml` parses a registry that uses lone CR everywhere.

## Comments

### @nzila at 2026-10-22 07:21:43 +00:00

Done: Implemented and committed a80f9ae0db0a82b70f3152a4cd4592c1e0135dba (fix(hub): report registry syntax errors at lone-CR file lines). Worktree clean.

Followed plan.path's one-commit task without scope changes. Read task 72's landed outcome and src/markdown/frontmatter.ts first; matched its complete-terminator LF/CRLF/lone-CR offset scan and `at line N, column C` suffix, without a fence adjustment. Private hub helper avoids a markdown import, so architecture/boundaries remain unchanged. Read/write formatting uses the exact parsed text, rendering once per write. Existing alias refusal remains green. README documents no-LF position preservation; all-CR parsing and frontmatter untouched.

Test-first: added all four planned exact-message rows. Correct attempt-local TMPDIR run before production changes: 32 pass, 3 fail (required LF and mixed-CRLF fixtures expected line 5, received 4; alias-property fixture expected 4:12, received 3:12). All-CR preservation passed. After implementation and final spacing edits: TMPDIR="$NZILA_HOME/attempts/$NZILA_ATTEMPT/probe-tmp" bun test test/hub/registry.test.ts test/cli/bin.test.ts => 35 pass, 0 fail. Separately completed bun run lint and bun run typecheck => exit 0. git diff --check clean before commit.

Failures reported along the way: initial TMPDIR inside worktree caused an additional CLI discovery assertion failure (31 pass/4 fail); corrected to the plan's attempt-local temp root, where CLI passed before production edits. This is an invocation correction, not a claim of a pre-existing test failure. Initial effect/AGENTS.md require.resolve failed through package exports; upward filesystem resolution succeeded and guide was read completely. Lint initially and on first spacing retry failed at registry.ts:219; corrected the blank line after multiline const head and final lint passed. No remaining failures.

Test-selection search run: rg -n 'yamlFailure|at line|Nested mappings|An alias node|Unresolved alias' src test; re-ran after edits in src/hub test/hub test/cli/bin.test.ts. Registry positions/alias messages pinned in registry suite and CLI bin suite; other hits were untouched frontmatter paths. No harness/rule changes.

External-code evidence: bun -e importing parseDocument,YAMLParseError on required and all-CR inputs observed syntax:true, pos:[28,29], YAML message 4:1 for required input and syntax:true, pos:[9,10], message 1:10 for all-CR input. Read landed frontmatter helper using /\r\n?|\n/g and +1 fence adjustment; read docs/architecture/hub.md confirming existing import boundaries. No decisions over nzila output parsers/matchers, so no gate-log corpus sampling applicable.

No installs, shared dependency edits, probe links, or writes to another checkout. Temporary worktree-local logs removed. Full gate intentionally left to check stage.

Review: approved (5/5)
Review of a80f9ae (base 518c2f7) — approve.

Required cases (brief Tests + Done when):
- Tests: `projects:\n  a: "x\ry"\n  b: [\n` names line 5 in exact message — PINNED in test/hub/registry.test.ts:165-166 `syntax errors keep their file position without a dangling colon` expects `Flow sequence ... end with a ] at line 5, column 1`. Test would have to see yaml LF-only `at line 4, column 1` to fail.
- Done when: registry syntax error below lone CR names line splitLines would put it on — PINNED by same row plus CRLF-mixed row test/hub/registry.test.ts:169-170 (same 5:1) and alias-col row test/hub/registry.test.ts:173-174 (4:12). All three shift by exactly the one lone CR above the error.
- Reversal (scratch detached worktree, base src/hub/registry.ts over new tests): TMPDIR probe run `bun test test/hub/registry.test.ts` gave 29 pass 3 fail with Received `at line 4, column 1` vs Expected `at line 5, column 1` (LF and CRLF rows) and Received `at line 3, column 12` vs Expected `at line 4, column 12` (alias row). Fourth new row (all-CR 1:10) passed unchanged. Proves tests pin fix, not literal.
- Property: none (exact-message table, not generative).

What to build:
1. Map error.pos[0] via LF/CRLF/lone-CR, put in message, local helper or shared + docs, or document gap — DONE. src/hub/registry.ts:54 offsetLineCol with `/\r\n?|\n/g` (rg src/hub/registry.ts:61), src/hub/registry.ts:220 `cause instanceof YAMLParseError ? cause.pos?.[0]`, src/hub/registry.ts:228 replaces terminal ` at line N, column C:` with mapped line/col. Private helper, no markdown import (imports are effect/yaml/../fs/./errors only), so architecture/boundaries unchanged — allowed alternative in task.
2. Read 72 outcome first so messages agree — DONE. 72 landed (607d744/b0c1837, todo/done/later/72...). Helper regex identical to frontmatter src/markdown/frontmatter.ts:47 `/\r\n?|\n/g` and lines src/markdown/lines.ts:33 `/\r\n?|\n/`; suffix `at line N, column C` same (frontmatter.ts:87 vs registry.ts:228), registry omits +1 fence as required. README + code comment state this.
3. All-lone-CR file out of reach, leave message — DONE. Guard src/hub/registry.ts:225 `text.includes("\n")` preserves yaml; row test/hub/registry.test.ts:177-178 `projects:\r  a: 1\r  b: [\r` expects yaml `Nested mappings ... at line 1, column 10` unchanged. Probe confirms yaml pos [9,10] msg 1:10.

Comments: Read brief task text (no Pre-start task comments block) and todo/later/73-a-lone-cr-in-the-hub-registry-shifts-a-syntax-error-line.md (29 lines, headings What to build/Tests/Done/Out of scope, no Comments section). Count 0, authors none. Nothing to walk; implementer report mentions no comments — consistent.

Implementer gaps: Single stated gap `Full bun run check / whole unit suite deliberately not run` — COVERED, not missing. check#1 ran brief check.command `bun run check` on a80f9ae: 1612 tests across 109 files (1484 pass/128 skip/0 fail). Do-stage left gate to check/land per instructions; reviewer did not re-run gate, only focused suites.

Commits: Single commit a80f9ae `fix(hub): report registry syntax errors at lone-CR file lines` answers fix rule. Diff stat 3 files (src/hub/registry.ts, test/hub/registry.test.ts, src/hub/README.md) all in scope. No hygiene outside diff.

Decision: Brief allowed mapping OR keep-line-plus-docs. Code does mapping with README documenting no-LF exception — no contradiction.

Check named: `bun run check` (Artifacts check.command), passed on check.commit a80f9ae. Done-when names no command.

Fixture numbers (not code): bun -e parseDocument probe observed pos [28,29]/yaml 4:1 for required input, [31,32]/4:1 CRLF-mixed, [32,34]/3:12 alias, [9,10]/1:10 all-CR, [12,13]/2:1 LF baseline, [16,18]/1:17 alias baseline. splitLines probe: required text lines ["projects:","  a: \"x","y\"","  b: ["] + virtual EOF line 5; helper gives 5:1, 5:1, 4:12, 1:10 — consistent with lineAt+1 and totals. Asserted 5/5, 4/12, 1/10 correct.

Constraints kept: Frontmatter untouched (rg at line hits only in frontmatter tests, unchanged); all-CR parsing untouched (guard + test); no hub->markdown import (rg from.*markdown in registry.ts empty); file prefix + first-line + no-dangling-colon kept (registry.ts:222); alias refusal paths unchanged (alias tests green in 35 pass).

Cost at scale (measured, error path only): `bun -e` 1000x offsetLineCol on 128900-char 5k-line mixed text: 2543.7ms total, 2.544ms/scan. One scan per syntax error (rare, single file), negligible vs yaml parse. No scale risk.

Spec: docs/spec.md has no line-number contract (rg line.*column|linePos|splitLines in docs/spec.md empty). README file-coordinates sentence stays true. No drift. No migration. No double-read hazard: read reads file once, write renders once via Effect.try(render) then flatMap validation closing over immutable text string; no shared mutable state across executions, no long command/crash window.

Predicate class (yamlFailure + offsetLineCol + no-LF guard): Tried LF loneCR->5:1, CRLF+loneCR->5:1, alias loneCR->4:12, all-CR preserved, LF baseline 2:1, CRLF baseline 2:1, first-line `[\n`->2:1, tab indent->2:1, unclosed quote->3:1, duplicate keys->3:3. All match splitLines/lineAt. Deliberately did not try block-scalar lone-CR second-parse, non-BMP offsets, or custom yaml tags — out of scope (frontmatter elsewhere, no repo fixture) and no tag config on this entry point.

External side (yaml lib, real record via `bun -e import parseDocument,YAMLParseError`): task yaml msgs with trailing colon, pos arrays above, `instanceof YAMLParseError:true` for syntax errors. Synchronous, no retry/second event. No pos-absent parser error observed on this machine; fallback preserves 71 behavior (defensive, acceptable). Stated as open question only for unobserved branch, not approval blocker.

Modules: No new module/dir. Tests colocated as required (next to 71 test).

Linter: `bun run lint` exits 0, oxfmt `All matched files use the correct format` on 268 files, oxlint silent; gate output `Found 0 warnings and 0 errors`. N=0, M=0, no increment to attribute. `bun run typecheck` exits 0. `git diff --check` clean.

No new config/flag/intent; helper producer is src (read/write), not tests-only.

Verification (plan): Step1 focused `TMPDIR=... bun test test/hub/registry.test.ts test/cli/bin.test.ts` quoted base 31 pass/prediction after 35 pass — OBSERVED after: 35 pass 0 fail 77 expect() calls. Known-bad actually run in scratch (base code + new tests): 29 pass 3 fail on registry file alone (plus bin 3 = 35 total), failures exactly LF/CRLF 5:1 vs 4:1 and alias 4:12 vs 3:12, all-CR passed. Step2 lint — PREDICTED unobserved in plan, OBSERVED now clean. Step3 typecheck — PREDICTED, OBSERVED clean. Searches re-run: rg yamlFailure|at line|Nested|An alias|Unresolved in src test pins syntax/alias in registry suite + bin alias; remaining hits frontmatter paths untouched.

Absence claims with proof: Search `Keep the file position` across repo returns empty now; same phrase in base `git show 518c2f7:src/hub/registry.ts` line 193 proves search works — no stale copy. Search `at line 5, column 1` finds only test/hub/registry.test.ts:166,170 (live) — task evidence cites old 4:1 as history (dated), no live stale. Search `from.*markdown` in registry.ts empty — no forbidden import. Boundaries `bun test test/boundaries.test.ts` 13 pass 0 fail confirms graph.

Branch: nzila/01M5H70907897M4EGGFKS9K0BN

Branch: nzila/01M5H70907897M4EGGFKS9K0BN

nzila run 01M5H70907897M4EGGFKS9K0BN
