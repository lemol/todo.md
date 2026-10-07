---
title: "jira pull: copy the issue's components into extra.components"
tags: [jira]
triage: '{"complexity": "simple", "risk": "low", "workDomains": ["backend"], "areas": ["src/jira/pull.ts", "src/jira/client.ts", "src/jira/README.md", "test/jira/pull.test.ts", "test/cli/jira-pull.test.ts"], "uncertainty": ["Whether the pull''s search request already asks for the components field."], "rationale": "One more mapped field in a pure plan, following the pattern title and assignee already use.", "rubricVersion": 1}'
group: Hub and sources
completed_at: 2026-10-07T00:50:36Z
outcome: completed
---
**Why.** nzila routes a task on a shared team list to the repository that does it (nzila's docs/specs/m9-team-tasks.md §5 and §8), and the team's Jira says which repository through the issue's **components**. Today `todo jira pull` keeps only `extra.jira_id` from the issue, so the routing field never arrives.

**Decisions.**
- The pull writes the issue's component names to `extra.components`, joined with `, ` in Jira's order. An issue with no components leaves the field absent, and removes it if it was set by an earlier pull.
- Linked tasks follow it on every pull, as they already follow title, description, assignee and status. Like them, the field is overwritten, not merged.
- The search requests the `components` field.
- `--dry-run` shows component changes in the plan.

**Build.** Mapping in `src/jira/pull.ts` (the pure `planPull`), the field in the search request, and `src/jira/README.md`.

**Tests first.** `test/jira/pull.test.ts`: components added, changed, cleared, and an issue with none. A CLI test in `test/cli/jira-pull.test.ts` showing the field in the list.

**Out of scope.** A configurable field map (`fields: { customfield_10042: repo }`), the natural next step.

## Comments

### @nzila at 2026-10-07 00:50:36 +00:00

Done: Built task 38: `todo jira pull` now copies an issue's components into `extra.components`. Lint, typecheck and the focused tests all pass.

Commits on the branch, test first:
- **Request and map components:** `src/jira/mapping.ts` requests `components` in `issueFields` and joins the trimmed, non-empty names with `, ` in Jira's order. An issue with none leaves the key absent. The mapping tests and the client fields assert failed first, then passed.
- **Carry it through the pull:** `src/jira/pull.ts` (`planPull` and `patchFor`) adds `extra.components` next to `jira_id` on a new task. A linked task has the key overwritten, and removed when Jira has none. Other local `extra` keys are kept, and other Jira extras never leak in. Three of the four new pull tests failed first. The fourth, "issue with none", already passed before the code change, as expected.
- **CLI test and README:** `test/cli/jira-pull.test.ts` shows the field in the list (`show --json`), then a dry run listing `(extra)`, then the follow-up pull. It passed on first run because task 2 had already done the work. `src/jira/README.md` documents the field. No CLI code changed.

Checks, each run on its own:
- `bun run lint`: clean.
- `bun run typecheck`: clean.
- `bun test test/jira/pull.test.ts test/jira/mapping.test.ts test/jira/client.test.ts test/jira/fixtures.test.ts test/cli/jira-pull.test.ts`: 76 pass, 0 fail.
- Value search: `rg -n "components|issueFields" src test -l`. It also lists `test/web/ui.test.tsx`, which I did not run; its `components` hit was not examined.

I did not run `bun run check`.

Ruling: `taskFromIssue` is shared with Jira source sync, so synced Jira projects also gain a read-only `extra.components`. The plan accepted this. If it is wrong, it costs one extra key on synced tasks.

I did not use the `superpowers:` skill names, because they were unknown to the skill tool. I loaded `executing-plans` and `test-driven-development` by their unprefixed names. I did not load `receiving-code-review` (the brief carried no review notes) or `verification-before-completion`. I did not write the ledger or run the final review pass that executing-plans describes.

Review: approved (4/5)
review#1: approved. `todo jira pull` copies issue components into `extra.components` exactly as task 38 specifies.

Required cases and where each is pinned:
- components added: test/jira/pull.test.ts "adds components into extra alongside jira_id".
- components changed (overwrite, other local extras kept): test/jira/pull.test.ts "follows changed components, keeping other extra keys" (expects patch.extra {jira_id, components, note} while remote carries an extra status that must not leak).
- components cleared when the issue no longer has them: test/jira/pull.test.ts "clears components the issue no longer has".
- issue with none leaves the field absent: test/jira/pull.test.ts "leaves components absent when the issue has none" plus test/jira/mapping.test.ts "leaves components absent when the issue has none" (absent / [] / blank-and-null names).
- join order/format: test/jira/mapping.test.ts "joins component names with ', ' in Jira's order".
- search requests the field: test/jira/client.test.ts `expect(asked).toContain("components")` in "sends the JQL and the fields it maps".
- CLI end-to-end (field in the list + dry-run): test/cli/jira-pull.test.ts "copies components into extra.components and follows them" (show --json pins {jira_id, components:"api, web"}, dry-run pins "Would update" + "(extra)", second pull pins "mobile"). This test runs through the real fake (test/jira/fake.ts project(), lines 128-151, strips unrequested fields), so it also pins the request end-to-end, not just the unit assert.

Reversal (scratch copy outside the worktree, node_modules symlinked then removed): deleted the `["components", componentsOf(issue)]` entry from extraOf and ran `bun test test/jira/mapping.test.ts` -> 27 pass / 1 fail, "joins component names with ', ' in Jira's order" fails with Expected "api, web", Received undefined. The test pins the behavior, not the literal. Note: planPull unit tests build remotes as Task literals with extra pre-set, so they pin the carry logic only; the mapping->pull chain is pinned by the CLI test above.

What to build (spec Build line): mapping of the join in src/jira/mapping.ts componentsOf/extraOf (the pure planPull carry lives in src/jira/pull.ts patchFor + add branch, as the plan laid out) - done; `components` in the search request via issueFields (src/jira/mapping.ts:102, consumed src/jira/client.ts:208) - done, and it also flows to single-issue fetch which shares issueFields; src/jira/README.md mapping row (:151) and pull linked row (:189) - done. Out of scope (configurable field map) not attempted - confirmed absent, no `customfield` plumbing found. Task has no Comments section, so nothing to walk there.

Class checks on the two predicates (mapping componentsOf over issue names; pull componentsOf over task.extra): tried whitespace-padded remote " api " vs local "api" -> no update (trim-normalized, correct); "API" vs "api" -> update (case-sensitive overwrite, correct); blank remote "  " with local "api"+note -> clears key, keeps note; non-string local extra (number) treated as absent -> no spurious update. Deliberately did not try: unicode/casefold variants (join preserves Jira's exact names by design) and multi-thousand-component issues (Jira caps components per issue; join is O(k) string work, no extra I/O - no scale cost to measure; focused suite ran 76 pass in ~4.3s).

Other verified claims: shared `taskFromIssue` also gives synced Jira projects read-only extra.components via src/jira/store.ts:66 taskFor - plan accepted this, implementer disclosed it; no live Jira reachable from this machine, so the fake's field projection is the record of the other side (read, not assumed). test/web/ui.test.tsx `components` hit is UI components, unrelated - examined, not just listed. No stale copies: `extra.components` occurs only in src/jira/README.md (live), the three test files (pins), todo task-38 file + plan (dated history); search proved live by re-finding the README sentence it indexes. Quantities re-derived: my rerun of the do pattern gives 76 pass / 0 fail across the 5 files, matching the report; lint clean (oxfmt+oxlint, 0 warnings, 244 files) and typecheck clean, each run alone; base was green per check#1 (1317 tests).

Notes (non-blocking, next touch):
1. src/jira/pull.ts:88 exports `componentsField`, but unlike `jiraIdField` it is not re-exported from src/jira/index.ts and nothing imports it (rg shows only pull.ts hits). Either re-export it next to jiraIdField or make it module-private.
2. planPull add branch calls `componentsOf(remote)` twice (lines 183/185); hoist to a const.
3. Optional: src/cli/README.md `todo jira pull` row still summarizes following as "title, description, assignee and status" - now omits extra.components. It was already a summary (omits tags/dependsOn), so leaving it is defensible; update it if the row is meant to be exhaustive.

Branch: nzila/01M49WWWBRVJE377S4J9ES2J1F

nzila run 01M49WWWBRVJE377S4J9ES2J1F
