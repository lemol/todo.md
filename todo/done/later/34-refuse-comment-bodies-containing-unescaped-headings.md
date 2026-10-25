---
title: Refuse comment bodies containing unescaped headings
group: Later
completed_at: 2026-10-05T06:03:11Z
outcome: completed
---
Writing a comment whose body contains depth-3 headings outside code fences produces a file that todo-md's reader parses into multiple comments, failing check diagnostics. Even worse, depth-2 headings (ATX `## ` or setext `---` underlines) alter the file layout by replacing the `Comments` section, silently erasing all comments and folding them into the task description. `todo.comment` should refuse comment bodies containing unescaped depth-2 or depth-3 headings with a ValidationError rather than silently splitting them or destroying the layout.

## Comments

### @agent at 2026-10-05 06:03:11 +00:00

Done: Gate repair diagnosis for check#3 (commit 68ad53d, `bun run check`): 2 failures, neither caused by this branch's diff. No code change made; working tree clean; retry unchanged.

What failed (observed in gate.output <attempts>/01M45A5ZDJSS8MDZM2MRKMSG5T/output.log):
- `findListRoot > returns Option.none() when no list exists` (log line 1209)
- `the git store conforms to TodoStore > renameGroup renames a group in place, updating its tasks` (log line 1488)
- Both failures are the test/sandbox.ts:102 guard: "this test wrote outside its temporary directory, into /Users/lemol/.todo-md: ~ cache/<hash>.json" (log lines 1205, 1484). Note `~` (rewritten, not added): pre-existing real-home cache files were rewritten mid-suite. 1165 pass / 2 fail / 1287 tests.

Why the diff is exonerated (observed evidence, each rerunnable):
- `git show 68ad53d` touches only pure `hasUnescapedHeading` in src/markdown/taskFile.ts (adds `\n` prefix before parseAst) plus expectations in test/markdown/taskFile.test.ts and test/fs/writing.test.ts. It performs no I/O and cannot write hub-cache files.
- Neither failing test exercises comment code: the none-case only reads a temp Disk; git renameGroup operates on temp clones. The gate log itself shows the new `hasUnescapedHeading` tests passing (lines 244-245) and all comment-rejection tests passing (lines 1492-1494).
- check#1 and check#2 on this same branch passed the full suite (1287 tests); only check#3 failed, with both failures in tests unrelated to the task.

Contention, not causation (suspected cause, stated as suspicion):
- The rewritten `~/.todo-md/cache/*.json` files point to a concurrent writer to the shared real home: this machine hosts hundreds of orchestrator attempt dirs and check#3 ran with gate.queued 4. The guard attributes an external write to whichever test's afterEach runs next, which explains two unrelated tests failing on cache rewrites. Isolation runs cannot prove contention, but nothing in the diff can produce these writes.

Verification supporting unchanged retry (all on the unchanged commit 68ad53d, worktree clean):
- `bun test test/fs/discovery.test.ts` → 5 pass, 0 fail.
- `bun test test/git/conformance.test.ts -t "renameGroup renames a group in place"` → 1 pass, 0 fail.
- `bun run lint` → clean (oxfmt + oxlint, 0 warnings/errors).
- `bun run typecheck` → clean (tsc, no output).
- Full `bun run check` deliberately not re-run: the check stage owns the suite and re-running the whole gate by hand risks the same cross-run contention.

Review: approved (5/5)
review#3: approved. No findings. Both earlier findings stay fixed; the frontmatter-bypass fix (68ad53d) holds under a fresh 33-case class probe.

Finding status vs earlier rounds
- review#1 finding (rejection tests never pinned no-mutation): still FIXED. test/fs/writing.test.ts:253-277 snapshots TODO.md + tree and asserts get("1").comments == [] after EACH rejected body; test/cli/tasks.test.ts:458-473 asserts unchanged TODO.md/tree/comments after CLI rejection. Present and passing in the focused run (88 pass).
- review#2 finding (frontmatter-leading bodies bypassed the guard): still FIXED by 68ad53d. Re-verified live in this round (probe below): `---\ntitle: x\n---`, `---\n## sneaky\n---`, `---   \ntitle: x\n---` all return true, while `---\n\n---` and `---\nfoo` stay false. This round's code was already read in review#2, so no new code is being newly flagged.

Required-case audit (task brief has no Tests/Done-when/What-to-build/Comments sections; cases derived from its one paragraph)
- Depth-3 outside fences refused, not split: pinned by `hasUnescapedHeading > detects unescaped ATX and setext headings` (test/markdown/taskFile.test.ts:384-392, `### Heading 3` -> true) and store rejection of `### ATX 3` (test/fs/writing.test.ts:261-266). Embedded cross-check in this round's probe: a `### @...` body prepended yields 2 parsed comments (the splitting hazard), so refusal is load-bearing.
- Depth-2 ATX `## ` refused, not layout-destroying: pinned by markdown test (`## Heading 2` -> true), store rejection + unchanged-state (`## ATX 2`), CLI `refuses comment body with unescaped depth-2 heading` (test/cli/tasks.test.ts:458-473, nonzero exit + stderr + unchanged TODO.md/tree/comments). Embedded cross-check: `## x` yields 0 parsed comments (the erasure hazard).
- Depth-2 setext `---` refused: pinned by markdown test (`Heading\n---`, `Heading\n===` -> true) and store rejection + unchanged-state (`Setext\n---`). Embedded: `a\n---` yields 0 comments.
- Refusal is ValidationError: pinned by `failsWith(..., "ValidationError")` (test/fs/writing.test.ts:262) and CLI stderr `comment body must not contain unescaped headings` (test/cli/tasks.test.ts:467). Guard reads validated `valid.body` once and fails before `mutate` (src/fs/FsTodoStore.ts:492-498); no re-read, no I/O in the predicate, so no TOCTOU or cross-crash state. Retry holds: the same store test performs a valid `store.comment` after four rejections and it succeeds (test/fs/writing.test.ts:269-274), proving no poisoned state.
- Allowed inputs keep working: pinned by `allows depth 4 or deeper, code fences, inline code, and escapes` (test/markdown/taskFile.test.ts:395-403) and the store echo (test/fs/writing.test.ts:274). The echo assertion is a single expect() over a request-supplied literal; sensitivity shown by probe reversal (see below), and persistence of allowed comments is covered by pre-existing tests (store comment test, CLI content assertions).
- Level-1 refusal (`# Heading 1` -> true) goes beyond the brief's "depth-2 or depth-3" but is per spec §2.6 (MUST NOT contain L1-L3, docs/spec.md:444 area) and fails safe; not scope creep. No property generator exists in the repo, so hand probes substitute.

Plan walk (docs/superpowers/plans/2026-10-05-refuse-comment-headings.md)
- Task 1 (predicate + spec §2.10): done — src/markdown/taskFile.ts:365-371, re-exported via barrel, spec docs/spec.md:587-593, tests above.
- Task 2 (guard + store/CLI tests): done — guard src/fs/FsTodoStore.ts:488-496 precedes mutate; store + CLI tests above incl. unchanged-state assertions.
- Verification steps: focused `bun test test/markdown/taskFile.test.ts test/fs/writing.test.ts test/cli/tasks.test.ts test/boundaries.test.ts` OBSERVED 88 pass, 0 fail (237 expect calls). `bun x oxlint` exit 0 with no warnings/errors output; `bun x tsc --noEmit` clean; `git diff --check` clean. Full gate left to check stage; check#4 already passed on this exact commit (68ad53d, 1287 tests).

Class check (this round, bun <attempt>/probe/class.ts, 33 cases each with embedded-reader cross-check via prependComment+parseTaskFile): tried ATX 1/2/3, 2- and 3-space indents, closing sequences, after-blank, comment-shaped `### @...`, setext `-`/`=` incl. trailing spaces, 3 frontmatter-leading variants, fm-empty, fm-unclosed, 4-space indented code, `#`-nospace, H4/H5, backtick/tilde/info-string fences, unclosed fence, inline code, `\##` escapes, blockquote/list nesting, HTML block, CRLF, plain, empty — ALL 33 matched expectations with embedded comments counts confirming the hazard model (every pred=true ATX-2/setext/fm case yields 0 reloaded comments). Deliberately not: GFM tables/refs (no heading interaction); memory/jira stores (no markdown layout; git delegates to fs at src/git/store.ts:104-105, hub changes.ts:185 and core wrap-then-delegate, so the single fs guard covers every markdown-writing flow); unclosed-fence swallowing (different class than headings, task doesn't ask — probed anyway as allowed/safe).

Reversal: the echo test's literal is request-supplied; full-copy reversal was impractical (worktree resolves node_modules by walking up to the project root, a /tmp copy would not resolve), so sensitivity was demonstrated at the predicate level via probe (bun <attempt>/probe/reversal.ts): flipping the allowed-body expectation to true fails (pred=false), flipping `## Heading 2` to false fails (pred=true). Prior round review#1 additionally did a real scratch-copy reversal of the echo literal and observed the failure.

Cost at scale (recorded evidence, not a finding): bun probe/scale2.ts (post-warmup, 3 runs each): typical 2KB allowed 1.0-3.6ms, 2KB refused ~0.7-1.1ms, 100KB allowed ~263ms, 1.2MB allowed 3.3-4.0s. One full parse per comment, linear in body size; human-scale bodies cost single-digit ms. No test measures it and none needs to; no threshold in the task.

Searches (whole repo, proven by hitting live copies)
- `rg -n 'hasUnescapedHeading' .`: definition src/markdown/taskFile.ts:370, import+use src/fs/FsTodoStore.ts:15,492, markdown tests, plan refs (dated). Single consumer; no stale callers.
- `rg -n -F 'comment body must not contain unescaped headings' .`: live impl src/fs/FsTodoStore.ts:494, live CLI assertion test/cli/tasks.test.ts:467, plan refs (dated). No other copies.
- Removed-side phrases: `Promote the task if it is inline` -> only docs/spec.md:590 (live step 2, renumbered); `Insert the new comment directly below the heading` -> only docs/spec.md:592 (live step 4). No stale duplicates; searches proven by hitting these live lines. Spec §2.10 (docs/spec.md:587-593) matches the code exactly (refuse L1-L3 -> promote -> create section -> insert).
- No new module/directory/config/flag/event created; CLI help untouched (no new command/flag); boundaries test passes (fs->markdown import allowed).

Linter: `bun x oxlint` exit 0, zero warnings/errors output; no baseline rerun needed (branch adds no new lint surface beyond blank-line style, which oxlint enforces and passes). tsc clean, diff-check clean. Worktree clean, no files written, no commits made.

