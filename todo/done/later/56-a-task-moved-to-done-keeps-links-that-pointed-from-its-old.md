---
title: A task moved to done/ keeps links that pointed from its old directory
tags: [bug]
group: Later
completed_at: 2026-10-22T00:55:46Z
outcome: completed
---
Seen twice on 2026-10-21 in another project. `todo done` moved `todo/a-session-in-the-app/16-….md` to `todo/done/a-session-in-the-app/16-….md`, and `todo/planning-in-the-app/03-….md` to `todo/done/planning-in-the-app/03-….md`. Each move goes one directory deeper. The task bodies' relative links, such as `../../product/projects/…/README.md`, were written from the old directory, so after the move they point one level short. That project's `check-docs` then reported them broken. We fixed them by hand. `reopen` makes the reverse move and would break them the other way.

#### Done when

Moving a task file between `todo/<group>/` and `todo/done/<group>/`, by `done`, `cancel` or `reopen`, rewrites its relative Markdown links so they resolve to the same targets. Absolute URLs, anchors-only links (`#…`) and links that did not resolve before the move are left as they are. A test covers a link that resolves before and after `done` and after `reopen`.

## Comments

### @agent at 2026-10-22 00:55:46 +00:00

Done: Committed 86f28c2 (fix(fs): preserve Markdown destination syntax when rebasing links). Worktree is clean.

Addressed all review notes; no pushback:
- R1: encode path components and parentheses so rewritten destinations remain valid Markdown and keep their decoded targets. Markdown-escape the retained query/fragment so ampersands cannot become character references and parentheses cannot terminate destinations.
- R2: validate entity-bearing spans using the existing CommonMark parser's decoding, including named, decimal and hexadecimal character references; no new dependency.
- R3: bound backtick searches to the node and match complete runs of exactly the opening length.
- R4: use the planned Effect.fnUntraced convention, providing Path.layer as its combinator.

Regression tests use real temporary files and independently reparsed AST URLs, not the destination scanner as their oracle. Links, images and definitions cover escaped opening/closing parentheses, entity-looking filenames, named/numeric entities and query/fragment punctuation. Tests check both directions, including independently seeded archived destinations, and existence of resolved targets. Backtick cases include separate paragraphs and unequal run lengths. Existing complete/cancel/reopen integration cases remain green.

Observed red-to-green runs of bun test test/fs/links.test.ts:
- R1 filenames: 2 pass / 9 fail, then 11 pass / 0 fail.
- R2 entities: 11 pass / 9 fail, then 20 pass / 0 fail.
- R3 backticks: 22 pass / 2 fail; added an independently demonstrated unequal-run reproduction, yielding 22 pass / 3 fail; then 25 pass / 0 fail.
- R1 query/fragment: 25 pass / 3 fail, then 28 pass / 0 fail.
All failures were reported before fixes; none were classified as unrelated.

Verification, separately completed:
- bun run lint: initially four padding-line diagnostics in the changed files; targeted fixes applied. Final run passes with no diagnostics.
- bun run typecheck: passes (both runs).
- bun test test/fs/links.test.ts test/fs/writing.test.ts test/fs/normalization.test.ts test/fs/config.test.ts test/fs/conformance.test.ts test/cli/tasks.test.ts test/boundaries.test.ts test/markdown: 355 pass / 0 fail across 20 files.
- git diff --check: passes.

Post-change reference searches:
- rg -n 'doneDir|tasksDir|completeEntry|cancelEntry|reopen|completed_at|outcome' src/fs test/fs test/cli test/spec test/boundaries.test.ts (112 lines).
- rg -n 'link|definition|destination|url' src/markdown test/markdown src/fs test/fs test/boundaries.test.ts (203 lines).
- rg -n 'rebaseTaskLinks|markdownLinkDestinations|decodedDestination' src test (26 lines).
These cover the shared writer/reopen routes and their normalization/config/conformance/CLI tests. No defaults, configuration fields, command lists or shared test-harness rules changed.

Plan continuation: the initial implementation commit already existed, so this visit makes one corrective commit rather than repeating task 1. The entity decoder reuses parseAst to avoid maintaining CommonMark character-reference rules or changing dependencies. No spec changes needed: fixes implement the existing relocation promise. No shared-install or other-checkout changes, no cross-project tasks. No orchestrator-output parser/predicate was changed, so recorded-output corpus sampling does not apply. Whole gate intentionally left to check stage.

Review: approved (4/5)
Reviewed the whole f2c09b9..dd508d7 diff: 10 files, commits b0c605b, 86f28c2 and dd508d7. I read it against task 56, spec §2.10, the plan and check#3. Approved.

EARLIER FINDINGS
- R1–R4 (round 1) were fixed by 86f28c2, as review#2 confirmed. Code unchanged since then except decodedDestination.
- R5 (round 2) is fixed in dd508d7. In src/markdown/links.ts, decodedDestination now escapes any unescaped `<`/`>` before parsing in angle form: `const angled = raw.replace(/\\[\s\S]|[<>]/g, (match) => match.length === 2 ? match : `\\${match}`)`.
  - Known-bad check in a scratch copy: I replaced it with `const angled = raw`. bun test test/fs/links.test.ts gave 31 pass / 6 fail. The six were "rebased link|image|definition retains decoded target a&>b.md / a&<b.md …". With the fix back: green.
- Nothing new is blocking.

CLASS PROBES (scratch, real files, AST-reparsed, both directions)
These rebase and resolve correctly:
- `../a&amp;<<b.md` (two angles)
- `../a&amp;\\<b.md` (escaped backslash, then a real `<`)
- `<../a&amp;b\\>` (angle form ending in an escaped backslash)
- entity destination with an entity in the title
- newline-padded destination
- blockquoted definition `> [r]: ../a&amp;<b.md`
- list-item link `../a&amp;>b.md`

Observation, not blocking. A plain destination whose path ends in a literal backslash, followed by a title, is left unrebased. Examples: `[x](../ab\ "t")` and `[x](../a&amp;b\ "t")`, with target file `ab\` present. In destinationAt, `if (char === "\\") j++` also skips a backslash before whitespace, so the span absorbs the title and no longer matches node.url. This code dates from b0c605b, which rounds 1 and 2 also read. I don't block on it for three reasons:
- it needs a file name ending in `\` plus a title;
- the link is left as written, never corrupted;
- markdownLinkDestinations' doc says unmatched destinations are left out rather than guessed.
If you want it gone: skip only when the next character is ASCII punctuation.

Not probed:
- Windows drive paths (the helper fixes POSIX Path.layer);
- HTML `<a href>` (outside "Markdown link destinations").

TASK AUDIT
- Comments: I read the brief (no "Pre-start task comments" supplied) and todo/later/56-a-task-moved-to-done-keeps-links-that-pointed-from-its-old.md. Its only heading is `#### Done when` (line 7) and it has no Comments section. That makes 0 comments and no authors.
- What to build: there are no numbered items in the brief or the task file. Plan task 1 is done in:
  - src/markdown/links.ts;
  - src/fs/links.ts;
  - src/fs/writing.ts (rebaseEntry in completeEntry/cancelEntry; normalization goes through completeEntry);
  - src/fs/FsTodoStore.ts (reopen);
  - spec §2.10 and both READMEs.

DONE-WHEN COVERAGE
- done/cancel/reopen rewrite relative links: test/fs/writing.test.ts, "complete|cancel|reopen preserves relative Markdown targets". Each is an exact-body comparison, so it fails on any byte rebased wrongly or not rebased.
- Absolute URLs, `#…` and unresolved links left as written: pinned by the same exact bodies.
- A link resolving before done, after done and after reopen: the same tests, plus test/fs/links.test.ts "rebased … retains decoded target … in both directions". Each loop case fails if the reparsed URL is not `../../<target>` after the move, or not `../<target>` after reopen and after a seeded reopen.
- Single-expect reversal (scratch): I changed the archived `disk.exists(...)).toBe(true)` to `toBe(false)`. Result: 27 fail ("Expected: false / Received: true"), 10 pass.
- No properties or generators.
- No new module directories. The pure-scanner tests still live in test/fs/links.test.ts rather than test/markdown, as noted in earlier rounds; not blocking.

IMPLEMENTER GAPS
- "Did not run bun run check": closed by check#3. The brief's check.command is `bun run check`. check#3 passed dd508d7: "Ran 1477 tests across 107 files", 1349 pass / 128 skip / 0 fail (output.log:1852-1856). I did not rerun the gate.

VERIFICATION
- Focused command, run by me: bun test test/fs/links.test.ts test/fs/writing.test.ts test/fs/normalization.test.ts test/fs/config.test.ts test/fs/conformance.test.ts test/cli/tasks.test.ts test/boundaries.test.ts gave "Ran 220 tests across 7 files", 0 fail. That is round 2's 211 plus 9 (3 new destinations × 3 syntaxes), which agrees with the review-fix's 31+6=37 links tests.
- Linter: "Found 0 warnings and 0 errors." (check#3 output.log:8). The baseline from rounds 1 and 2 was also 0. My `bun run lint` is clean.
- Stale references: `rg -n "decodedDestination|angle form" src test docs todo` finds only src/markdown/links.ts:12, :16 and :138, all live.
- The diff changes no counts, defaults, config fields, CLI flags or events. The spec still matches the code.
- Commits: all three are task-56 scope. No orchestrator-owned rule commits.
- Reads: target existence is checked before any write, and the write order is unchanged. Because of the list lock, only an external deletion between check and move could interfere, and the link would then be rebased to a missing target. That is acceptable.

COST AT SCALE (scratch test/fs/review-scale3.test.ts, real disk, one move)
| links | plain | angle-entity (`../a&amp;>b.md`) |
| ----- | ----- | -------------------------------- |
| 100   | 27.0ms | 26.0ms |
| 1000  | 175.6ms | 197.9ms |
| 5000  | 581.3ms | 1328.6ms |

Entity destinations cost about 2.3x at 5000 because of the extra parseAst call per link. That is fine at task-file sizes.

Scratch worktree removed. The branch is clean and the shared install untouched.

