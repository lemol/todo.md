---
title: A rebased link is re-spelled with percent escapes
tags: [bug]
group: Later
completed_at: 2026-10-22T01:21:00Z
outcome: completed
---
todo-md:56 (`b0c605b`, `86f28c2`, `dd508d7`) rebases a moved task file's relative links. `encode` in `src/fs/links.ts` rebuilds every rebased destination from the decoded path with `encodeURIComponent` per segment, so characters the author wrote plainly come back escaped, and `done` then `reopen` does not restore the original bytes. Controller probe on `756b909` (scratch test, real files, `todo/group/task.md` to `todo/done/group/task.md` and back):

| written | after done | after reopen |
| --- | --- | --- |
| `../a+b.md` | `../../a%2Bb.md` | `../a%2Bb.md` |
| `../über.md` | `../../%C3%BCber.md` | `../%C3%BCber.md` |
| `<../My Notes.md>` | `<../../My%20Notes.md>` | `<../My%20Notes.md>` |
| `../a,b@c.md` | `../../a%2Cb%40c.md` | `../a%2Cb%40c.md` |
| `./sib.md` | `../../group/sib.md` | `sib.md` |

The links still resolve, but the file a person reads is harder to read, and a done/reopen round trip leaves a diff in lines nobody edited (spec §2.10's minimal diffs). review#2 saw the non-ASCII case and called it optional; the ASCII cases (`+`, `,`, `@`, space) went unnoticed.

#### What to build

1. Keep the destination's own spelling where it can be kept: change only the leading `./`/`../` steps and the path segments the move actually changes, and copy the rest of the raw text (escapes, entities, percent escapes, plain Unicode) as written. Escape only what the destination's form needs (plain vs `<…>`) for a segment that has to be written fresh.
2. A link that was rebased on `done` comes back byte-for-byte on `reopen` when nothing else changed, `./` prefix included where the original had one.

#### Tests first

- In `test/fs/links.test.ts`: the five rows above, each as link, image and definition, assert the archived text and that the reopened text equals the original source exactly (not only the reparsed URL).
- The existing "retains decoded target" cases (parens, entities, angle brackets) keep passing.

#### Done when

Rebasing changes only the path steps the move requires, and done then reopen restores the original bytes for the cases above.

#### Out of scope

Group moves (58), inbound links from other files.

## Comments

### @nzila at 2026-10-22 01:21 +00:00

Done: Rebased links now preserve the author's spelling (`src/fs/links.ts`).

What changed: `rebaseTaskLinks` splits the raw destination into pathname + query/fragment (verbatim suffix), decodes per-segment, and reuses the longest trailing raw segments whose decoded values match the new relative path. Only the changed leading `..`/`.` steps and moved directory segments are written fresh, via a minimal `encodeFresh` (plain vs `<…>` safelists keep `+ , @`, space-in-angle, and non-ASCII raw; exotic bytes fall back to `encodeURIComponent`). A new relative that is bare gets a canonical `./` prefix, so `./sib.md` round-trips (`../../group/sib.md` back to `./sib.md`). Mismatched `?#`/segment splits fall back to the legacy full-encode path.

Tests (`test/fs/links.test.ts`): added the five probe rows (`../a+b.md`, `../über.md`, `<../My Notes.md>`, `../a,b@c.md`, `./sib.md`), each as link, image, and definition (15 tests), asserting the archived text and byte-exact reopen. Existing "retains decoded target" and query/fragment cases keep passing.

Verified: `bun test test/fs/links.test.ts test/fs/writing.test.ts` 71 pass; `bun test test/boundaries.test.ts` 13 pass; `bun run lint` clean; `bun run typecheck` clean. New tests failed before the fix with the reported over-escaping (`%2B`, `%C3%BC`, `%20`, `%2C%40`, `sib.md` vs `./sib.md`) and pass after. Did not run the full `bun run check` gate per instructions. Searched `src/` for `rebaseTaskLinks` (used by `writing.ts`, `FsTodoStore.ts`) and `test/` for `%2B`/`My%20Notes`; the pinning suite is `test/fs/writing.test.ts` ("moving a task file keeps its relative links"), which passes. No gaps.

Review: approved (5/5)
review#1 of do#1 (701a2a7) — approved.

Required cases (task Tests-first + Done-when), all pinned in test/fs/links.test.ts:
- `../a+b.md` as link/image/definition: `rebased <syntax> preserves spelling ../a+b.md byte-for-byte` (test/fs/links.test.ts:157-176) asserts archived `[x](../../a+b.md)` and reopened equals source bytes.
- `../über.md`: same block asserts `../../über.md` archived, source bytes on reopen.
- `<../My Notes.md>`: same block asserts `<../../My Notes.md>` archived, source bytes on reopen.
- `../a,b@c.md`: same block asserts `../../a,b@c.md` archived, source bytes on reopen.
- `./sib.md` as link/image/definition: `rebased <syntax> preserves spelling ./sib.md byte-for-byte` (test/fs/links.test.ts:190-203) asserts archived `../../group/sib.md` and reopened `./sib.md` bytes.
- Existing `retains decoded target` cases (parens, entities `&amp;`/`&copy;`, angle brackets, test/fs/links.test.ts:69-111) and `retains Markdown-significant query and fragment` (test/fs/links.test.ts:121-138) still pass — 52/52 in links.test.ts.
What a new test would see on failure: archived `../../a%2Bb.md`, `../../%C3%BCber.md`, `<../../My%20Notes.md>`, `../../a%2Cb%40c.md`, or reopened `sib.md` (no `./`) / `../a%2B…`. Reversal in a scratch worktree (base src/fs/links.ts + new tests): 15 fail with exactly those over-escapings (`+ "[x](../../a%2Bb.md)`, `+ "[x](../../%C3%BCber.md)`, `+ "[x](<../../My%20Notes.md>)`, `+ "[x](../../a%2Cb%40c.md)`, `- "[x](./sib.md)` / `+ "[x](sib.md)`), 37 pass; with the fix 52 pass. So the tests pin the bug, not the fix's literals.

What-to-build:
1. Keep destination spelling, change only leading steps/changed segments, escape fresh per plain vs `<…>` — done (src/fs/links.ts:22-34 safelists + encodeFresh, :143-176 longest-trailing-raw keep + fresh/kept splice, rawSuffix verbatim).
2. done→reopen byte-for-byte incl. `./` — done (keep logic reuses raw trailing segs; bare-new-relative canonical `./` prefix at :174 restores `./sib.md`; all 15 tests assert `toBe(source)` on reopen).

Comments: read the task file's Comments section (absent — todo/later/57-*.md has frontmatter + What-to-build/Tests/Done-when/Out-of-scope only, no Comments heading, no @nzila lines) and the brief's Pre-start task comments (absent). Count 0, authors none. Nothing to walk.

Implementer's stated gaps: report states `No gaps` and notes the full gate was deliberately not run per instructions. No gap to verify; the named suites (links, writing pinning test `moving a task file keeps its relative links`) were run here: 84 pass across links+writing+boundaries.

Commits vs rule: single commit 701a2a7 `fix(fs): preserve raw link spelling when rebasing task links` answers task 57 (src/fs/links.ts + test/fs/links.test.ts only). No out-of-rule commit.

Check command: passed per brief `check.command` = `bun run check` on 701a2a7 (gate.output: 1364 pass, 128 skip, 0 fail, 1492 tests, 62.38s). The Done-when names no command; do#1 ran narrower checks (links+writing 71 pass, boundaries 13 pass, lint, typecheck) — the narrower run is expected, the full gate is the check stage's.

No fixture-encodes-bug: expected archived strings come from the task table, and reversal shows old code produces the task's `after done` column. No left-out constraint: callers are complete/cancel (src/fs/writing.ts:48) and reopen (src/fs/FsTodoStore.ts:398) only — no group-move (58) or inbound-link handling, per Out-of-scope.
Cost at scale (measured, not quoted): 2000-link file rebases in 128 ms (`bun probe-cost.ts` → `links=2000 chars=36000 out=42000 ms=128`), ~0.06 ms/link, linear stats; no perf concern.
Spec/docs: spec §2.10 (minimal diffs, only-destination-text-changes, existing-file-only, query/fragment kept) now holds; src/fs/README.md:77-80 `Moving task files` paragraph stays accurate; no doc drift. Reads: loop iterates destinations descending so `result[start-1]`/`result[end]` (isAngle, src/fs/links.ts:141) and slice indices stay stable; per-link `files.exists` is a stat, no cross-command state; crash order unchanged (done-file commit point).
Predicates class-checked (beyond the five rows): markdownLinkDestinations probe showed plain-space yields no destination (so plainSafe excluding space is required), entity slice `../a&amp;b.md` vs url `../a&b.md`, pct preserved. rebase probes round-tripped byte-exact: `../a&amp;b.md`→`../../a&amp;b.md`, `../a%2Bb.md`, `../a+b.md?x=a+b#frag`, `<../My Notes.md?x=1&y=2#frag>`, plus fresh-dir encoding: space-group plain→`../../my%20group/sib.md` vs angle→`<../../my group/sib.md>`, plus-group→`../../a+b/sib.md`, all with `roundtrip=true`. Deliberately not tried: fresh segments with `()[]` in angle form and `&sol;`-style entity slashes (defensive legacy-fallback path, still resolves; group moves are out of scope per 58). No external events/errors added.
Modules: none created, so colocated-tests rule is vacuous. Boundaries 13/13 pass.
Linter: `bunx oxlint` 0 warnings (exit 0, no output); `bunx oxfmt --check` clean on 266 files; no increment over base attributable to the diff. Stale-copy search: `rg -n "encodeURIComponent\(part\)"` finds only src/fs/links.ts:19 (positive control proves the search works); `rg -n "plainSafe|angleSafe|encodeFresh"` finds only links.ts; `rg -n "rebaseTaskLinks"` finds only writing.ts, FsTodoStore.ts, README, tests, todo/58 note — no stale copy.

Branch: nzila/01M5GJ1SBTXPV2PRK8VPWDX2Y3

nzila run 01M5GJ1SBTXPV2PRK8VPWDX2Y3
