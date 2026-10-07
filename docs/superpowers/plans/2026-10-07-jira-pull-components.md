# Jira Pull Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `todo jira pull` copies the issue's component names into `extra.components`.

**Architecture:** Request `components` in the search, join names to one string in `extra`, and carry that key through the pure `planPull` for adds and updates.

**Tech Stack:** Bun, Effect 4, `bun:test` + `effectTest`.

**Spec:** `todo/hub-and-sources/38-jira-pull-copy-the-issue-s-components-into-extra-components.md`

**Base:** `ff33cc0` (2026-10-07). Observed output below is at this commit.

## Global Constraints

- Minimal diffs: splice text, never re-serialize (spec §2.10).
- Style: blank-line/brace rules; `bun run fix` applies oxlint + oxfmt.
- Out of scope: configurable field map (`fields: { customfield_10042: repo }`).
- Every command/test/snippet below is marked observed (ran) or unobserved (not run).

---

## Files

- Modify `src/jira/mapping.ts`: `Issue` decodes `components`, `issueFields` requests it, `extraOf` joins names.
- Modify `src/jira/pull.ts`: `planPull` add branch + `patchFor` carry `extra.components`.
- Modify `src/jira/README.md`: mapping `extra` row + pull linked row.
- Test `test/jira/mapping.test.ts`: join + absent (in `taskFromIssue: extra`).
- Test `test/jira/client.test.ts`: one-line assert (diff in `sends the JQL and the fields it maps`).
- Test `test/jira/pull.test.ts`: added, changed, cleared, none (in `planPull`).
- Test `test/cli/jira-pull.test.ts`: field in list + dry-run (in `todo jira pull`).

## Load-bearing claims (all observed at base)

- `patch.extra` replaces whole `extra`, so pull must merge. Ran `rg -n "extra: patch.extra|extra \?\? task.extra" src/fs/FsTodoStore.ts` → `185: extra: patch.extra ?? task.extra,` and `194: ...(patch.extra === undefined ? {} : { extra: patch.extra }),`.
- Search and single-issue fetch share `issueFields`. Ran `rg -n "issueFields" src/jira/client.ts src/jira/mapping.ts` → `client.ts:208: const fields = issueFields.join(",")`, `mapping.ts:93: export const issueFields…`; `client.ts:293: fields,` (search) and `client.ts:297: issue: (key) => get(at(key), Issue, { fields }, key)`.
- Dry-run update lines list `Object.keys(patch)`, so a components change shows as `(extra)` with no CLI change. Ran `rg -n "Object.keys\(change.patch\)" src/jira/pull.ts` → `276: ...(change.kind === "update" ? { fields: Object.keys(change.patch) } : {}),`.
- `taskFromIssue` is shared by pull and source sync. Ran `rg -n "taskFromIssue|taskFor" src/jira/pull.ts src/jira/JiraSource.ts src/jira/store.ts` → `pull.ts:217`, `store.ts:66` (`taskFor`), `JiraSource.ts:123`. Accepted: synced Jira projects also gain read-only `extra.components`.
- Fake Jira strips unrequested fields, so the CLI test pins the request too. Ran `rg -n "project\(issue, fields" test/jira/fake.ts` → `262:` (search) and `347:` (single issue).

### Task 1: Request and map components

**Files:**
- Modify: `src/jira/mapping.ts`
- Test: `test/jira/mapping.test.ts`
- Test: `test/jira/client.test.ts` (one-line diff)

**Decision:** Forgiving `components` array of `{ name }`; join trimmed non-empty names with `", "` in Jira order; empty/absent → key absent.

**Produces:** `issueFields` contains `"components"`; `taskFromIssue(...).extra.components?: string`.

- [ ] **Step 1: Write the failing tests** (unobserved — new code for `do` to paste)

```ts
test("joins component names with ', ' in Jira's order", () => {
  const task = map(issue({ components: [{ name: "api" }, { name: "web" }] }))
  expect(task.extra.components).toBe("api, web")
})
test("leaves components absent when the issue has none", () => {
  expect(map(issue()).extra.components).toBeUndefined()
  expect(map(issue({ components: [] })).extra.components).toBeUndefined()
  expect(map(issue({ components: [{ name: "  " }, { name: null }] })).extra.components).toBeUndefined()
})
```

Plus in `test/jira/client.test.ts` after the `issuelinks` assert: `expect(asked).toContain("components")` (unobserved).

- [ ] **Step 2: Run to verify they fail** — `bun test test/jira/mapping.test.ts test/jira/client.test.ts` (pattern observed at base; new asserts unobserved, expected FAIL).
- [ ] **Step 3: Minimal implementation** (unobserved — signatures + illustrative lines only): `Issue.fields` gains `components: Maybe(Schema.Array(Named))`; `issueFields` appends `"components"`; `extraOf` gains `["components", joined ?? undefined]`.
- [ ] **Step 4: Run to verify pass** — same command (baseline in Verification).
- [ ] **Step 5: Commit** — `git add src/jira/mapping.ts test/jira/mapping.test.ts test/jira/client.test.ts` + commit `feat(jira): request and map components` (unobserved).

### Task 2: Carry extra.components through planPull

**Files:**
- Modify: `src/jira/pull.ts`
- Test: `test/jira/pull.test.ts`

**Decision:** Add sets `extra: { jira_id, ...(components ? { components } : {}) }`; update overwrites only the `components` key (other local extras preserved, `jira_id` kept); blank/absent remote clears; other remote extras never leak.

**Consumes:** Task 1 `extra.components?: string`. **Produces:** `planPull` add/update carry it; components change yields `patch.extra`.

- [ ] **Step 1: Write the failing tests** (unobserved)

```ts
test("adds components into extra alongside jira_id", () => {
  const plan = planPull([], [issue("PROJ-1", { extra: { components: "api, web" } })])
  expect(plan.changes[0]).toMatchObject({ kind: "add", input: { extra: { jira_id: "PROJ-1", components: "api, web" } } })
})
test("follows changed components, keeping other extra keys", () => {
  const local = [linked("4", "PROJ-1", { extra: { components: "api", note: "mine" } })]
  const plan = planPull(local, [issue("PROJ-1", { title: "PROJ-1", extra: { components: "api, web", status: "To Do" } })])
  expect(plan.changes).toEqual([{ kind: "update", key: "PROJ-1", id: "4", patch: { extra: { jira_id: "PROJ-1", components: "api, web", note: "mine" } } }])
})
test("clears components the issue no longer has", () => {
  const local = [linked("4", "PROJ-1", { extra: { components: "api" } })]
  const plan = planPull(local, [issue("PROJ-1", { title: "PROJ-1" })])
  expect(plan.changes).toEqual([{ kind: "update", key: "PROJ-1", id: "4", patch: { extra: { jira_id: "PROJ-1" } } }])
})
test("leaves components absent when the issue has none", () => {
  const plan = planPull([], [issue("PROJ-1", { extra: { status: "To Do" } })])
  expect(plan.changes[0]).toMatchObject({ kind: "add", input: { extra: { jira_id: "PROJ-1" } } })
  expect((plan.changes[0] as { input: { extra: Record<string, unknown> } }).input.extra.components).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify they fail** — `bun test test/jira/pull.test.ts` (pattern observed; new asserts unobserved, expected FAIL).
- [ ] **Step 3: Minimal implementation** (unobserved): helper `componentsOf(extra: Extra): string | undefined` (trimmed, `undefined` when blank); add branch spreads it; `patchFor` builds next `extra` (illustrative: `{ ...local.extra, ...(next === undefined ? {} : { components: next }) }`, key dropped when cleared).
- [ ] **Step 4: Run to verify pass** — same command (baseline `12 pass / 0 fail`, see Verification).
- [ ] **Step 5: Commit** — `git add src/jira/pull.ts test/jira/pull.test.ts` + commit `feat(jira): pull carries extra.components` (unobserved).

### Task 3: CLI coverage and docs

**Files:**
- Modify: `src/jira/README.md`
- Test: `test/cli/jira-pull.test.ts`

**Decision:** No CLI code change — dry-run already reports `(extra)` via `Object.keys(patch)`; README documents `extra.components` as overwritten, absent when none.

- [ ] **Step 1: Write the failing CLI test** (unobserved)

```ts
effectTest("copies components into extra.components and follows them", withPull((run, jira) => Effect.gen(function* () {
  jira.put(anIssue("PROJ-1", { summary: "Rework auth", components: [{ name: "api" }, { name: "web" }] }))
  yield* run("jira", "pull")
  expect(JSON.parse((yield* run("show", "2", "--json")).stdout).view.task.extra).toEqual({ jira_id: "PROJ-1", components: "api, web" })
  jira.put(anIssue("PROJ-1", { summary: "Rework auth", components: [{ name: "mobile" }] }))
  expect((yield* run("jira", "pull", "--dry-run")).stdout).toContain("Would update 02  Rework auth  PROJ-1 (extra)")
  yield* run("jira", "pull")
  expect(JSON.parse((yield* run("show", "2", "--json")).stdout).view.task.extra.components).toBe("mobile")
}),), list)
```

- [ ] **Step 2: Run to verify it fails** — `bun test test/cli/jira-pull.test.ts` (pattern observed; new test unobserved, expected FAIL).
- [ ] **Step 3: Docs only** (unobserved): mapping table `extra` row gains `components`; pull linked row gains `extra.components follows Jira (overwritten; absent when none)`.
- [ ] **Step 4: Run to verify pass** — same command.
- [ ] **Step 5: Commit** — `git add src/jira/README.md test/cli/jira-pull.test.ts` + commit `docs(jira): pull documents extra.components` (unobserved).

## Verification (instruction for `do`; planner ran baselines only)

`do` runs, each to completion, in this order: (1) `bun run lint`, (2) `bun run typecheck`, (3) focused tests below. All three are unobserved (planner did not run the gate or the post-fix suite).

Focused tests (one pattern): `bun test test/jira/pull.test.ts test/jira/mapping.test.ts test/jira/client.test.ts test/jira/fixtures.test.ts test/cli/jira-pull.test.ts`. Found by `rg -n "components|issueFields" src/ test/` (request + mapping + pull + triage uncertainty) and `rg -n "extra" src/jira test/jira test/cli/jira-pull.test.ts` (extra pins in mapping/fixtures/store/pull/CLI); shared harness is `test/jira/fake.ts` field projection. Report lists the search it ran.

Baselines observed at `ff33cc0`: `bun test test/jira/pull.test.ts` → `12 pass / 0 fail`; `bun test test/cli/jira-pull.test.ts test/jira/mapping.test.ts test/jira/client.test.ts` → `53 pass / 0 fail`.

Known-bad (both observed failing at base, single pattern suffices): `/tmp/components-probe.test.ts` asserting `expect(issueFields).toContain("components")` → `1 fail`, `Received: [ "summary", "description", "labels", "assignee", "status", "priority", "issuelinks", "resolutiondate", "comment", "project" ]`; `/tmp/pull-components-probe.test.ts` asserting add carries `components` → `1 fail` (`- Expected - 1 / + Received + 0`).
