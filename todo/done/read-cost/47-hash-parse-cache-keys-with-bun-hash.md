---
title: Hash parse-cache keys with Bun.hash
tags: [perf]
group: Read cost
completed_at: 2026-10-21T17:09:08Z
outcome: completed
---
Every process hashes the full text of every file in the list to build the
parse-cache key (`keyOf`, `src/fs/parsing.ts`), in JavaScript (cyrb53). On
another project's list (596 files, 4.7 MB) that is 9.6 ms cold per command; `Bun.hash`
over the same texts takes 2.0 ms. In a CPU profile of
`todo --project <other> ls`, `hash` is the largest piece of real work (~18 ms
with profiler overhead), ahead of parsing `TODO.md`.

Use `Bun.hash` for `keyOf`. The key format changes, so existing cache files
miss once and are rewritten; no version bump is needed since a miss only
re-parses. Keep cyrb53 (or anything stable) for the cache file name, which
`forgetGone` relies on. (The sandbox guard no longer watches `cache/`, since
48.) The cache stays never a source of
truth: an identical text at the same path is still the only reuse.

Done when: `keyOf` over a 600-file, ~5 MB list costs under 3 ms cold,
`todo list` output is unchanged, and `bun run check` passes.

Depends on nothing; measure after "Ship the todo CLI as a bundle" lands, since
startup otherwise hides the gain.

## Comments

### @agent at 2026-10-21 17:09:08 +00:00

Done: Addressed review F1: docs/architecture/README.md rule on Bun/Node APIs now records a deliberate exception: `fs` calls the global `Bun.hash` for parse-cache keys (src/fs/parsing.ts), so fs runs on Bun only. Chose the doc fix over injecting the hash from the composition root (cheaper, as the review suggested).
Minor note (tautological first expect in the keyOf test): left as is; the literal pin follows it and is optional per the review.
Verified: `bun run lint` clean after the doc edit (docs only, no code change). Not run: full gate (left to check stage). No gaps.
Commit: docs(architecture) on top of ffc1e13.

Review: approved (5/5)
Review#2 of todo-md:47 (diff `2675e67..f28bd95`: `docs/architecture/README.md`, `src/fs/README.md`, `src/fs/parsing.ts`, `test/fs/parsing.test.ts`). Approved.

#### Earlier findings (`review#1`) and what is new

- **F1 (`review#1` `changes` finding): Fixed.** Commit `f28bd95` updates `docs/architecture/README.md:99-102` to record the deliberate exception:
  > Only apps (`cli`, `web`) choose and wire adapters, and only app composition roots touch Bun or Node APIs directly. One deliberate exception: `fs` calls the global `Bun.hash` for parse-cache keys (`src/fs/parsing.ts`), so `fs` runs on Bun only.
- **New in round 2:** Only `docs/architecture/README.md:99-102` changed between `ffc1e13` and `f28bd95`. No new findings in `f28bd95` or in code read in `review#1`.

#### Done-when, required tests, and scratch reversals

1. **`keyOf` over a 600-file, ~5 MB list costs under 3 ms cold (Done-when #1):**
   - Not pinned by a unit test (appropriate for a wall-clock benchmark); measured directly across 5 cold runs with `bun <attempts>/01M5FNQ4P3P6TKAZY3H4Z85VK1/bench/keyof.ts $PWD <other>/todo`:
     - HEAD (`f28bd95`): `files=596 chars=4697597 ms=1.26`, `1.23`, `1.26`, `1.29`, `1.23` (all under 3 ms).
     - Base (`2675e67`, cyrb53 `keyOf`): `files=596 chars=4697597 ms=10.80`, `9.04`, `9.27`.
   - Re-derives the quantities in commit `ffc1e13` ("from 9.0 ms to 1.3 ms") and the doc comment in `src/fs/parsing.ts:56-57` ("several times faster than `hash` over a whole list", ~7.4x).
2. **`todo list` output is unchanged (Done-when #2):**
   - Measured on a fresh copy of that list at `<attempt>/list` with isolated `HOME` and `TODO_MD_HOME`:
     - Base `2675e67` (`writes cyrb53 cache`), HEAD `f28bd95` first run (`misses old cyrb53 keys and rewrites cache`), and HEAD `f28bd95` second run (`hits new Bun.hash keys`) each printed 606 lines and compared byte-identical via `cmp` (`base1 vs head_miss: SAME`, `base1 vs head_hit: SAME`).
3. **`bun run check` passes (Done-when #3 / `check.command`):**
   - Brief `check.command` is `bun run check` (identical to the Done-when command). `check#2` ran `bun run check` (`bun run lint && bun run typecheck && bun run test`) on `f28bd95dc60e9d40b31828722b9b04754d5c0151` and passed: `1304 pass, 128 skip, 0 fail`, `Ran 1432 tests across 105 files. [54.91s]` (`<attempts>/01M5FPBQTXHBMJBN8Z1CQ8DDTE/output.log:1803-1807`).
4. **Added/updated tests in `test/fs/parsing.test.ts` and scratch reversals:**
   - `test/fs/parsing.test.ts:49-52` (`keyOf > keys a parse by path, length and Bun.hash of the text`): asserts `keyOf("01-a.md", withComment)` is `"01-a.md:197:z484hkxqy8ou"` (where `withComment.length === 197` and `Bun.hash(withComment).toString(36) === "z484hkxqy8ou"`).
     - Reversed in detached worktree (`src/fs/parsing.ts:60` reverted to `hash(source)`): failed with `Expected: "01-a.md:197:z484hkxqy8ou", Received: "01-a.md:197:1woid7foeyd"`.
     - Reversed in detached worktree (`src/fs/parsing.ts:60` dropping `${path}:`): failed with `Expected: "01-a.md:197:z484hkxqy8ou", Received: "197:z484hkxqy8ou"`.
   - `test/fs/parsing.test.ts:99-122` (`makeParser > keeps parses in the cache file, for the next parser of the same list`, pin at `test/fs/parsing.test.ts:113`): asserts `expect(cacheFile).toBe("cache/1zxjo77c9fm.json")` (`hash("/list")`).
     - Reversed in detached worktree (`src/fs/parsing.ts:136` changed to `Bun.hash(root).toString(36)`): failed with `Expected: "cache/1zxjo77c9fm.json", Received: "cache/398yv3m17v99f.json"`.
   - `test/fs/parsing.test.ts:124-143` (`makeParser > misses an entry under the old cyrb53 key, and saves it under the new one`): replaces the entry key in the cache file with old cyrb53 key `"01-a.md:197:1woid7foeyd"` and payload `"From the cache"`, then reads and asserts `missed?.description` is `"Token bucket."` (`test/fs/parsing.test.ts:137`) and `Object.keys(saved.entries)` is `[key]` (`test/fs/parsing.test.ts:140`).
     - Reversed in detached worktree (`src/fs/parsing.ts:60` reverted to `hash(source)`): failed at `test/fs/parsing.test.ts:137` with `Expected: "Token bucket.", Received: "From the cache"`.

#### What to build, Decisions, and Constraints

- The brief has no numbered "What to build" list; its requirements in prose are all done:
  - Use `Bun.hash` for `keyOf`: done in `src/fs/parsing.ts:59-60`.
  - Existing cache files miss once and are rewritten without a version bump: done (`taskFileParserVersion` in `src/fs/parsing.ts:19,84,176` is unchanged; `end` in `src/fs/parsing.ts:239-246` replaces `taskFiles` with `used` and saves when `fresh` is true).
  - Keep cyrb53 for the cache file name (`forgetGone` relies on it): done (`hash` in `src/fs/parsing.ts:38-53` and `path.join(cacheDir, `${hash(root)}.json`)` in `src/fs/parsing.ts:136` are unchanged).
  - Cache stays never a source of truth (only an identical text at the same path reuses a parse): done (`src/fs/parsing.ts:59-60,217-225`).

#### Task comments

- Read the task brief (no "Pre-start task comments" section) and `todo/read-cost/47-hash-parse-cache-keys-with-bun-hash.md:1-23` (no `## Comments` section). Comment count: 0; authors: none.

#### Implementer's stated gaps and plan verification

- Both `do#1` and `do#2` state: full gate left to `check`, no gaps. `check#1` and `check#2` ran `bun run check` and passed.
- All 5 verification steps in `<attempts>/01M5FNQ4P3P6TKAZY3H4Z85VK1/plan.md:81-102` (focused tests `23 pass / 0 fail` + known-bad reversals, `bun run lint`, `bun run typecheck`, cold `keyOf` benchmark + known-bad cyrb53 baseline, and sandboxed `todo ls --all` comparison) were observed in the plan and re-run and confirmed in this review.

#### Commits on branch

- `git log 2675e676d92f3915d9a120cf044c8909fae82991..HEAD` contains only `ffc1e13` and `f28bd95` (both authored by `Leza Lutonda <lemol-c@hotmail.com>` for task 47); there are no orchestrator-authored commits on the branch to check against commit rules.

#### Stale references, value searches, and call sites

- Proved search patterns against `2675e67` blobs (`git show 2675e67:docs/architecture/README.md | rg -n "touch Bun or Node APIs directly"` -> line 100; `git show 2675e67:src/fs/parsing.ts | rg -n "a fast 53-bit string hash"` -> line 37; `git show 2675e67:src/fs/README.md | rg -n "<cacheDir>/<hash of root>\.json"` -> line 44) and ran `rg -n --hidden -g '!.git'` across the whole repository for removed phrases and changed values (`cyrb53|Bun\.hash|keyOf|1zxjo77c9fm|1woid7foeyd|z484hkxqy8ou|\bBun\.`):
  - `docs/architecture/README.md:100-101`: live, updated with the `Bun.hash` exception.
  - `src/fs/README.md:44-45`: live, updated to state `keyed by its path, its length and Bun.hash of its text`.
  - `src/fs/parsing.ts:37,56,59,60,86,217`: live, updated (`hash` comment for cache file name, `keyOf` doc and export, internal caller `taskFile` at line 217).
  - `test/fs/parsing.test.ts:4,48-51,111,113,125,131,134`: live, tests and pins for `keyOf` and `makeParser`.
  - `src/fs/snapshot.ts:99,120,142`, `docs/architecture/storage.md:65`, `todo/done/read-cost/43-a-board-reads-the-list-twice-and-the-resolver-opens-foreign.md:7`: unrelated `snapshot.ts` `keyOf` (stat-pass key).
  - `src/hub/registry.ts:48,57,150`, `docs/superpowers/plans/2026-09-13-hub-foundation.md:744,751,824`: unrelated `registry.ts` `keyOf` (YAML pair key).
  - `todo/done/read-cost/48-the-sandbox-guard-fails-a-test-for-another-process-s-parse.md:67`: dated historical review note from task 48.
  - `todo/TODO.md:25` and `todo/read-cost/47-hash-parse-cache-keys-with-bun-hash.md:2,6,7,12,14,19`: the task 47 entry and brief.
  - Other `Bun.` uses (`scripts/build-cli.ts:26,40`, `src/web/server.ts:92,97`, `test/git/helpers.ts:40`, `test/cli/bundle.test.ts:20,30,54,61,62,99,134`, `test/cli/bin.test.ts:16`, `test/sandbox.test.ts:64`, and dated design/plan docs under `docs/superpowers/`): unrelated to `fs`.
- Production call site: `keyOf` is called by `makeParser`'s `taskFile` method at `src/fs/parsing.ts:217` (wired into `FsTodoStore` via `src/fs/store.ts` and `src/hub/Hub.ts`), and exported from `src/fs/parsing.ts:59` (not `src/fs/index.ts`) for direct unit testing (`test/fs/parsing.test.ts:4`) and benchmarking.

#### Inputs, external events, linter, and layout

- **Inputs checked for `keyOf(path, source)`:** `01-a.md` with `withComment` (197 chars), 596 real task files in `<other>/todo` (4,697,597 chars total, including frontmatter, markdown bodies, and comments), cyrb53 reversal, path-omitted reversal, and root-hash reversal. Non-ASCII strings were evaluated in `<attempts>/01M5FNQ4P3P6TKAZY3H4Z85VK1/plan.md:78,94` (`Bun.hash` handles UTF-16/non-Latin-1 deterministically at ~2.6 ms over 600 files).
- **External events:** None (pure in-process hashing; any future `Bun.hash` output change across Bun versions causes a one-time cache miss and rewrite, identical to this migration).
- **Linter:** `0 warnings` (`Found 0 warnings and 0 errors.` in `<attempts>/01M5FPBQTXHBMJBN8Z1CQ8DDTE/output.log:8` and `bun run lint`); base `2675e67` had `0 warnings` (`Found 0 warnings and 0 errors.` via `bun run lint` in detached worktree at `2675e67`).
- **Colocation:** No new modules or directories created; tests remain in `test/fs/parsing.test.ts`.

