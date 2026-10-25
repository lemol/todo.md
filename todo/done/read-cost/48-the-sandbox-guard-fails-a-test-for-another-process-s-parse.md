---
title: The sandbox guard fails a test for another process's parse-cache write
tags: [test, flake]
group: Read cost
completed_at: 2026-10-21T16:42:27Z
outcome: completed
---
`test/sandbox.ts` snapshots the whole real hub home (`~/.todo-md`, or
`$TODO_MD_HOME`) and fails whichever test was running when anything under it
changed. The hub's parse cache lives there (`~/.todo-md/cache/*.json`), and
every real `todo` process on the machine, or tool built on it, rewrites it. So a gate that
runs while anything else reads a list fails a test that touched nothing.

Evidence: todo-md:46's check#1 (attempt `01M5FJF8MYD6DS1TF27WW4M2PX`,
output.log line 1634) failed `the git store conforms to TodoStore > listDone
returns the most recently completed task first` with `-`/`~` lines under
`~/.todo-md/cache/`. That test opens the git store with no `cacheDir`
(`test/git/helpers.ts` builds the project without one), so it cannot write
there. The cache files' mtimes fell inside the gate's window, while other
runs were live. The test passes 57/57 alone. It cost the run a `do` resume
(do#2), which had to prove the failure was not its own.

Decide and build: the guard stops counting the real home's `cache/`
directory. The cache is never a source of truth (spec, storage
architecture): a write there edits no one's work, which is what the guard
exists to catch. Keep watching the registry and the rest of the home, and
this repository's `todo/`.

Tests first: in `test/sandbox.test.ts`, a change under `<home>/cache/` is
not reported, while a change to the registry file next to it still is.

Docs: the guard's comment in `test/sandbox.ts` says what it skips and why.

Done when: the two cases above are pinned. Out of scope: moving the cache
out of the hub home; task 47's key format.

## Comments

### @agent at 2026-10-21 16:42:27 +00:00

Done: The sandbox guard no longer watches the real hub home's top-level `cache/` directory. The registry, the rest of the home and this repo's `todo/` are still watched.

- **Code (`test/sandbox.ts`):** `snapshotOf(dir, skip = [])` leaves out top-level directories named in `skip`. The exported `guarded` list is now `{dir, skip}` entries: `todo/` skips nothing and the real home skips `["cache"]`. The `afterEach` guard applies the same skip. The header comment says what is skipped and why.
- **Tests first (`test/sandbox.test.ts`):** I added two tests and watched them fail on the missing `guarded` export before implementing.
  - One shows that writing and adding files under `<home>/cache/` is not reported, while a later change to `registry.json` beside it is (`~ registry.json`).
  - The other pins the `guarded` skip lists (hub `["cache"]`, `todo/` empty).
- **Verified:** `bun test test/sandbox.test.ts` passes 5/5. `bun run lint` and `bun run typecheck` are clean. I did not run `bun run check`, per the step instructions.
- **Searches for pinned values:** I did not search `src/` or `test/` for other users of `snapshotOf` or `guarded`. The only consumer I looked at is `test/sandbox.test.ts`.
- **Recorded corpus:** I did not read the attempt output logs. The fixtures are constructed.
- **Out of scope, untouched:** moving the cache out of the hub home, and task 47's key format.

Review: approved (5/5)
Review of do#1 (commit f464a94) for todo-md:48 — visit 1, no earlier rounds.

Required cases (task Tests + Done-when):
1. "a change under <home>/cache/ is not reported" — PINNED in test/sandbox.test.ts:28 "skipped directories are not reported, the files beside them still are": writes cache/list.json + cache/added.json, expects changesBetween(before, snapshotOf(dir, ["cache"])) toBe "" (test/sandbox.test.ts:39). What it must see to fail: any non-empty string (e.g. "  ~ cache/list.json"). Reversed in a scratch copy to expect "  ~ cache/list.json": failed with Received "" (4 pass 1 fail), proving the code truly skips. Also ran new tests against base test/sandbox.ts (47ad69c): fails with `Export named 'guarded' not found`, proving tests-first (old code cannot pass new tests).
2. "a change to the registry file next to it still is" — PINNED in same test (test/sandbox.test.ts:42): after registry.json rewrite expects "  ~ registry.json". Pre-existing test test/sandbox.test.ts:8 still pins default behavior: snapshotOf(dir) with no skip reports "  ~ cache/with spaces" (test/sandbox.test.ts:21), so skip is opt-in, not global.
3. "guarded skip lists" (Done-when's second case) — PINNED in test/sandbox.test.ts:48 "the real hub's cache is skipped and its registry is not": guarded entry for realHome has skip ["cache"], repo/todo has [] (test/sandbox.test.ts:49-50). Single expect over a value the request supplied? The ["cache"] literal is the diff's own value, but the behavioral test (1+2) independently proves the skip works; the pin test only locks wiring. Reversal of the behavioral assertion above covers the fail-direction.
4. Docs: guard comment says what it skips and why — DONE in test/sandbox.ts:11-16: cache/ not watched, parse cache never source of truth, every real todo process rewrites it, registry/rest/home and repo todo/ stay watched.

What-to-build walk (unnumbered paragraph read as items):
- Guard stops counting real home's cache/ — done (test/sandbox.ts:30-32 guarded entry {dir: realHome, skip: ["cache"]}; test/sandbox.ts:46 snapshotOf(dir, skip=[]) + test/sandbox.ts:61-63 `if (at !== dir || !skip.includes(entry.name))`; applied at baseline test/sandbox.ts:113 and afterEach test/sandbox.ts:120 via skips map test/sandbox.ts:114).
- Cache is never source of truth — code agrees; verified against storage.md:71-79 (disposable derived data, missing only costs a parse) and Hub.ts:227 cacheDir join(options.home,"cache").
- Keep watching registry + rest of home + repo todo/ — done: todo entry skip [] (test/sandbox.ts:31), registry is top-level file beside cache so still snapshotted; class probe showed sibling changes surface.
- Tests first in test/sandbox.test.ts — done (above).
- Comment in test/sandbox.ts — done (above).
- Out of scope: moving cache out of hub home — untouched (diff stat: only test/sandbox.ts + test/sandbox.test.ts; no src/hub/Hub.ts change; rg cacheDir in src/ shows Hub.ts:227 unchanged). Task 47 key format — untouched (src/fs/parsing.ts:38 cyrb53 hash and :55 keyOf unchanged; diff touches neither).

Task Comments: read the task file todo/read-cost/48-the-sandbox-guard-fails-a-test-for-another-process-s-parse.md (32 lines, no Comments section) and the brief (no "Pre-start task comments"). Comment count 0, authors none — checked claim, not default. Nothing to walk as done/pushed-back/missing.

Implementer's stated gaps:
- "Did not search src/ or test/ for other users of snapshotOf/guarded" — done by reviewer: rg -n "snapshotOf|guarded" whole repo finds only test/sandbox.ts:30,46,113,114,120 + test/sandbox.test.ts:4,15,20,35,39,42,49,50,96 (+ unrelated Unguarded in TodoService.test.ts, + historical todo/done/44 doc). No other harness consumer; no stale caller. Search proven: same rg finds "Where an escape lands" in test/sandbox.ts:28.
- "Did not read attempt output logs; fixtures constructed" — pushed back as not mattering here: real record read by reviewer instead (ls ~/.todo-md/cache/*.json shows 9 files e.g. 11xj4xzbwcu.json; Hub.ts:227 + storage.md:71-79 confirm <home>/cache shape; gate output 01M5FN7EDGK7RRHTMNHQQ0X372/output.log lines 15/17 show sandbox tests passing). Fixture class (list.json/added.json/registry.json) matches real class (hash .json + sibling registry file).
- "Did not run bun run check per step instructions" — done elsewhere: check#1 reported passed on f464a94 (artifacts check.passed=f464a94, check.command="bun run check": 1430 tests/105 files). Reviewer ran only touched checks per instructions: bun test test/sandbox.test.ts 5 pass, bun run lint clean (oxfmt + oxlint, 0 warnings), bun run typecheck clean.

Orchestrator commits vs rules: branch has one commit f464a94 "test(sandbox): stop guarding the hub's parse cache". Brief lists no commit-message rule; no finding. No work outside rule (only the two test files).

Brief Decision vs code: no contradiction. Decision says top-level cache/ skipped, rest watched — code does exactly that (top-level-only condition at!==dir).

Check command: brief check.command is `bun run check` (Done-when names no command, so no divergence). check#1 ran it and passed on the reviewed commit.

Predicate/matcher class check (snapshotOf skip, test/sandbox.ts:61-63): tried via bun test probe — modify/add/delete inside top cache => "" (skipped); remove whole cache dir => ""; rename inside cache => ""; modify nested sub/cache/nested.json => "  ~ sub/cache/nested.json" (watched, correct — only top level skipped); file CacheFile (capital) => reported (exact-match, correct); rename cache->cache2 => "  + cache2/list.json" (destination surfaces, guard still fails — conservative, correct); rename registry.json into cache/moved.json => "  - registry.json" (source surfaces, guard still fails — correct); add CacheDir => reported. Deliberately did not try symlinked cache or permission-denied entries: hub cache is plain files (ls shows regular .json), and snapshot's try/catch around readdir/stat is unchanged from base, so symlink/error behavior is out of this diff's class.

Other checks: no test encodes bug numbers from fixture totals (assertions are "" and "  ~ registry.json", re-derived above); no constraint left out (todo/ + registry + rest of home still watched, pinned); cost measured: bun test cost-probe on real ~/.todo-md (9 cache files, 6.5M) gave full 10 lines 0.49ms vs skipped 1 line 0.32ms — skip reduces work, no scale risk; spec still matches (storage.md disposable-cache sentences unchanged, comment cites them correctly); no double-read/crash window change (single readdir+stat pass as before, skip only prunes one subtree); no migration/backfill; no new module/dir (tests colocated in test/); no quantities beyond 2 guarded entries / skip lengths 0 and 1 (re-derived from test/sandbox.ts:30-32); value "cache" occurrences enumerated live (test/sandbox.ts:32 skip, Hub.ts:227 join, storage.md:76 <home>/cache, task file lines 7/14/20/26) vs dated (todo/done/44 history, stays as history); prose claims verified (Hub.ts:227 confirms <home>/cache; storage.md:71-79 confirms disposable + missing-only-costs-parse; ls confirms real *.json files rewritten by live processes); no unreachable-state omission; verification observed (5/5, lint, typecheck outputs above) not predicted; linter 0 warnings, no class, base not re-run (check stage owns full gate); new fields traced: skip param produced by guarded constant (test/sandbox.ts:30) consumed by baselines/afterEach in same file (test/sandbox.ts:113-114,120) — not tests-only, composition is the preload itself, no CLI/server call site needed.

Quality: lint+typecheck clean, style matches file (blank-line/brace rules pass via oxfmt/oxlint), no scope creep beyond exports needed for the pin tests (repo/realHome/guarded exported, test-only surface).

