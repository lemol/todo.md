---
title: Editing one hub registry entry reformats the others
tags: [bug, hub]
group: Later
completed_at: 2026-10-22T05:54:37Z
outcome: completed
---
Found by the controller's post-land review of todo-md:68 (landed `95e9c79`). review#1 noted that `rename` rewrites `{source: memory}` as `{ source: memory }` and called it minor. It is larger than that: every registry edit reformats every entry, including the ones it never touched.

Evidence (scratch at `95e9c79`, own `HOME` and `TODO_MD_HOME`):

- `projects.yaml` = `# mine\nprojects:\n  a: {source: fs, path: <a long path>} # c\n  b: {source: fs, path: <a long path>}\n`. `todo projects rm b` exits 0 and removes `b`. It also rewrites `a`, which nobody edited, from one line into a five-line flow map (`a:\n    {\n      source: fs,\n      path: …\n    } # c`), because the entry is longer than `yaml`'s default `lineWidth` of 80.
- A short flow map gains padding: `{source: memory}` becomes `{ source: memory }` (review#1's probe, `rename`).

`write` in `src/hub/registry.ts` re-serializes the whole document with `doc.toString()`. The module comment says only "comments and order survive", so this is a gap in what an edit keeps, not a contradiction. But a person's hand-written registry should not change layout on lines the command did not touch.

#### What to build

1. Pick one and state it. (a) Keep the `toString` path and pass options that keep each node as parsed (`lineWidth: 0`, `flowCollectionPadding: false`, and whatever else the probe shows), so untouched lines come back byte-identical for the layouts the tests cover. (b) Splice: take the text from the source ranges of the nodes an edit touches, as the Markdown writer does (spec §2.10). (a) is the smaller change; (b) is the only one that holds for every layout.
2. The README's registry bullet says what an edit keeps.

#### Tests first

- `test/hub/registry.test.ts`: a registry with a flow-map entry over 80 columns, a padless flow map and a trailing comment. `delete` of a different entry leaves those lines byte-identical. The same for `rename` and `add`.

#### Done when

Removing, renaming or adding a registry entry leaves every other entry's lines as written, at least for the layouts the tests cover.

#### Out of scope

Task-file frontmatter, which already splices. Error messages (71).

## Comments

### @agent at 2026-10-22 05:54:37 +00:00

Done: Implemented plan tasks 1 and 2, in order, with separate commits:
- 8901d29 fix(hub): splice registry edits so untouched entries keep their layout
- 6514c85 docs(hub): say what a registry edit keeps

Chose (b), splicing, as planned. Block-map edits replace only a renamed key, delete an entry and its directly preceding same-indent comments, or append a new entry. Reparse after splices keeps sequential edits current; write validates the resulting document and aliases before atomic replacement. Missing/empty/flow projects use the planned Document fallback with lineWidth: 0 and flowCollectionPadding: false. README documents both paths. No plan deviations.

Tests first: added all five planned regressions and ran `bun test test/hub/registry.test.ts` before implementation: 23 pass, 5 fail. Failures reproduced long-flow folding, flow padding and indentation changes, first-entry comment retention, and the flow-projects fallback. After implementation all pass. Initial static failures (formatting, nullable YAML ranges, then a multiline-const blank line) were reported in notes and fixed; no failures were classified as pre-existing.

Verification on final commit, each command independently completed:
- `bun run lint`: pass
- `bun run typecheck`: pass
- `bun test test/hub/registry.test.ts`: 28 pass, 0 fail
- `bun test test/hub/Hub.test.ts test/hub/changes.test.ts test/cli/projects.test.ts`: 56 pass, 0 fail
- `git diff --check`: pass; working tree clean
Full gate/suite deliberately not run, per brief; check stage owns it.

Coverage searches run:
- `rg -l 'makeRegistry|registry.update|\.rename\(|projects rm|projects rename' test`: Hub, changes, registry tests.
- `rg -l 'projects.yaml' test`: additionally status, overview, resolve, sync, CLI projects/bin, web server/harness/fs-e2e. Hub and CLI projects contain exact first-add output assertions; exercised alongside changed registry tests and watcher integration tests. Other hits read registry fixtures rather than pin changed serialization options.
- `rg -n 'registry|lineWidth|flowCollectionPadding' src test`: located registry callers and the separate, unchanged Markdown frontmatter serializer. No test harness or shared default was changed.

Decision evidence rerun with `bun -e` importing yaml and comparing parseDocument(text).toString({lineWidth:0,flowCollectionPadding:false}) against mixed padded/padless maps and 4-space/extra-space input: both printed DIFF; padded maps lost padding and 4-space indentation became 2-space. This confirms options alone do not preserve these layouts. A separate node-range probe showed block-value range end stops before following blank/comment lines, while flow-value ranges stop at the closing brace, supporting the line-boundary splice rule.

No installs, shared-package edits, or changes outside this worktree. No outstanding acceptance gaps. CRLF append normalization remains outside scope as the plan states; missing/empty/flow-map fallback is documented rather than claiming preservation there.

Review: approved (5/5)
approved: todo-md:70 splice preserves untouched registry lines; README documents it.

check.command: `bun run check` (brief artifacts). check#1 passed on 6514c85: 1479 pass 128 skip 0 fail, 1607 tests across 109 files (gate.output tail). Reran touched suites: `bun test test/hub/registry.test.ts` 28 pass 0 fail; `bun test test/hub/Hub.test.ts test/hub/changes.test.ts test/cli/projects.test.ts` 56 pass 0 fail; `bun run lint` pass (oxfmt clean, oxlint no warnings, 0 warnings); `bun run typecheck` pass; `git diff --check` pass; `bun test test/boundaries.test.ts` 13 pass.

Tests / Done when (task Tests + Done when):
- delete leaves other lines byte-identical (long >80 flow, padless, padded, trailing comment, deep block): pinned test/hub/registry.test.ts:219-228 loop case `delete: a long flow map...` over fixture `untouched` (test/hub/registry.test.ts:197-205, len 105>80 measured) and `handwritten` (:207) with rest `[]`. To fail it must see folded `a` (5-line `a:/{...}`) or padded `m` (`{ source: memory }`).
- rename same: pinned same loop `rename` (test/hub/registry.test.ts:212 expects `  y: {source: memory}`). To fail must see reformatted untouched or wrong key splice. `y` is request-supplied; untouched preservation is fixture-supplied, not request-supplied, so reversal below covers liveness.
- add same: pinned same loop `add` (:213-217 expects `z` preserved + `c:/source/title`). To fail must see reformatted untouched or wrong indent/append.
- Reversal in scratch worktree (detached HEAD 6514c85, base registry.ts restored): `bun test test/hub/registry.test.ts` 23 pass 5 fail. Failures: flow test expected `projects: {a: {source: memory}}` got `projects: { a: { source: memory } }`; comment test kept `# The main one`; delete/rename/add showed folding+padding. Proves tests catch bug; observed, not predicted.
- comment-above-delete rule: pinned `delete takes the comment lines directly above the entry with it` (test/hub/registry.test.ts:231-242 over `commented` :15-24). To fail must keep `# The main one`.
- flow-projects fallback: pinned `an edit to a flow projects map rewrites it on one line without padding` (:244-257). Documents non-preservation there, per plan.

What to build:
1. Pick (a)/(b) and state it: done. Chose (b) splice. Stated in module comment src/hub/registry.ts:3-6 (`Edits splice the entry they change`), README src/hub/README.md:68-72 (`Edits splice the file`), commit 8901d29. Fallback Document with `lineWidth: 0, flowCollectionPadding: false` for missing/empty/flow (src/hub/registry.ts:178) per plan lines 26-28. No pushback.
2. README says what edit keeps: done src/hub/README.md:68-76 (splice, same-indent comments, blank lines, fallback, lock/re-read/tmp+rename).

Comments: read todo/later/70-editing-one-hub-registry-entry-reformats-the-others.md (29 lines, no Comments section) and brief Task (no Pre-start comments section). Count 0, authors none. Nothing to walk; implementer report mentions none, correctly.

Gaps:
- CRLF append: pushed (out of scope per plan Task1 constraints). Probe: CRLF delete preserves `...{source: memory}\r\n` (output `"projects:\r\n  a: {source: memory}\r\n"`); add uses `\n` by design. Not required (tests are LF).
- missing/empty/flow fallback documented not preserving: done (src/hub/registry.ts:178, README :71-72, flow test above).
- frontmatter, error messages (71): out of scope, untouched. frontmatter src/markdown/frontmatter.ts:83 unchanged; no RegistryError message change; alias tests still pass in 28.
- No outstanding gaps; implementer `No outstanding acceptance gaps` holds.

Commits vs rule (plan Task1 one commit, Task2 one commit):
- 8901d29 `fix(hub): splice registry edits...` touches src/hub/registry.ts + test/hub/registry.test.ts only — answers Task1.
- 6514c85 `docs(hub): say what a registry edit keeps` touches src/hub/README.md only — answers Task2.
No commit outside its rule.

Decision contradiction: none. Plan Decision (b) holds; probe reran: padded DIFF->`{source: memory}`, padless SAME, indent4 DIFF->2-space, mixed DIFF (command output). Confirms (a) cannot hold both paddings/indents, so splice required. Code implements splice + documented fallback.

Findings checked, no open finding:
- Fixture encodes bug correctly: long line 105 chars >80 (measured `len=105 >80=true`); default `parseDocument(t).toString()` folds `a` to 5 lines (`a:/{...}`) and pads `b` — re-derived, matches task evidence.
- Constraint left out: none. Lock/re-read/tmp+rename kept (src/hub/registry.ts:304-310, :286-293); sequential splice reparses (splice :67-70); noop delete leaves file identical (probe).
- Cost at scale: measured N=500 `delete z` in 142ms, `preserved=true` (command output). O(file) reparse per op, registry human-sized; no test needed.
- Spec: docs/architecture/hub.md:12-15 `Writes keep comments` still true (stronger); spec 2.10 minimal-diff pattern followed; no mismatch. Module graph: hub may import yaml (test/boundaries.test.ts:26); new `stringify` import allowed; relative `../fs` kept; boundaries 13 pass.
- Reads/race: read inside `lock(Effect.exit(edited))`, write validates (`parseDocument`+`toJS`) before tmp+rename; concurrent test passes.
- Migration: N/A.
- Predicate class (tried): rename quoting `y/2025/my app/a:b/a b/y:z/#hi/"q"` all round-trip via `stringify(to).trimEnd()`; delete blank-above kept (`...memory\n\n`), deeper `   #` kept (same-indent rule), header kept/first-comment taken, missing-key noop identical, delete-last leaves `projects:\n`, add-then-delete net-zero, add 4-space preserves untouched (new entry `    c:/      source` valid, 6>4), add no-trailing-nl inserts separator, seq rename+add+delete matches existing test, CRLF preserved, flow rename fallback. Deliberately not tried: tab indent (YAML forbids tabs, read fails RegistryError so unreachable as valid registry); newline in key (Hub validates via `isValidName` src/hub/Hub.ts:380,517 before `edit.add/rename`, write would reject — covered by `a failing edit writes nothing`).
- External: alias reuse/bomb/anchor-delete tests pass in 28; lock contention covered by concurrent test.
- Colocation: no new module; tests in test/hub/registry.test.ts colocated with src/hub/registry.ts.
- Quantities re-derived: 28, 56, 1607 (1479+128), 105>80, 5-line fold — all observed; README/prose quote no counts.
- Values searched: `rg -n lineWidth/flowCollectionPadding/comments and order survive/Edits use yaml/Edits splice` across src test docs todo scripts .agents. Live: src/hub/registry.ts:99,178; src/hub/README.md:68; src/markdown/frontmatter.ts:83 (separate, correctly unchanged). Dated: task file, docs/superpowers/plans/*, todo/done/* (history). No live stale copy; search proven (found task file line 12).
- Prose justification claims all ran (padding/indent probes above).
- Unreachable: none claimed; fallback states reachable+tested.
- Verification: plan expects 28/56/lint/typecheck clean — all observed via reruns; known-bad 5 fail observed in scratch, not predicted.
- Linter: `bun run lint` 0 warnings (oxfmt clean, oxlint silent); base also clean (check passed, diff introduces no warnings).
- New config/event: none; internal `splice/lineStart/lineEnd/endOf/block/rewritten` only; public `Registry/RegistryEdit` signatures unchanged; callers src/hub/Hub.ts:408,540 unchanged.

Quality: lint/typecheck/boundaries/diff-check clean; blank-line/brace style holds; docs updated in same diff.

