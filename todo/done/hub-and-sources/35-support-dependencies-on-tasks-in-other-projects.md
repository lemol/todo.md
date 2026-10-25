---
title: Support dependencies on tasks in other projects
tags: [hub, spec]
group: Hub and sources
completed_at: 2026-10-05T02:09:40Z
outcome: completed
---
A task in one list often waits on a task in another. On 2026-10-02, filing work that waits on `slash-usage:01` and `slash-usage:07` from other lists failed: `todo add … --project workspace --depends-on slash-usage:01` says "task project slash-usage contradicts --project workspace", and with `--dir` it says "use --project or --dir, not both". The dependency ended up as bold prose in each description, which `ready`/`blocked` can't see.

The hub design lists cross-project dependencies as a non-goal (`docs/superpowers/specs/2026-09-13-hub-design.md`, Non-goals and §CLI: "anchors and dependencies in another project, are usage errors"). The CLI disagrees with itself, though:

- `--depends-on`'s help says "(<project>:<id> works too)".
- In `src/cli/commands/tasks.ts` (`add`, `edit`, `mv`), the prefix of a qualified dependency or anchor picks **which project the command runs on** (`projectOfRefs` → `withTodo({ project })`), and only `ref.id` is stored. Run from a list's directory without `--project`, `todo add X --depends-on other:7` quietly adds X to *other*'s list with a dependency on its own task 7, instead of failing.

## What to decide (the person, first)

- **Whether to lift the non-goal.** If not, fix only the bug: a qualified dependency or anchor whose project isn't the target is a usage error, the help text says "same project only", and the command never retargets.
- **How a cross-project reference is stored.** `depends_on: [3, "slash-usage:1"]` uses registry names, which are per machine (`~/.todo-md`). A list read without the hub, or on a machine that names the project differently, can't resolve it. Options: registry names, plus treating an unresolvable reference as unsatisfied with a warning; or a portable reference (a git remote URL + id, or `projects` aliases declared in the list itself).
- **What the standard says.** Today `docs/spec.md` §1.3 and §2 (frontmatter `depends_on`: "Integers or digit strings") and the inline `depends_on:1,2` allow only local ids. A foreign reference either becomes part of the standard, or stays a hub extension that a plain `TodoService` keeps but doesn't evaluate.

## What to build (once decided)

- Parse and render qualified ids in inline and frontmatter `depends_on`, round-tripping unchanged.
- `ready`/`blocked` across projects through the hub: a foreign dependency is satisfied when that task is done with outcome `completed`. One that can't be resolved (unknown project, unsynced remote, missing id) is unsatisfied and gets a diagnostic, never an error that blocks the whole list.
- `check`: `unknown-dependency` for foreign ids, plus a new diagnostic for an unresolvable project. Cycle detection across projects as far as the hub can see.
- CLI: `--depends-on <project>:<id>` stores the qualified reference on the target project's task; `show`/`ls` render it qualified, with its state; `todo done other:7` lists newly ready tasks in every project.
- The retargeting bug fixed regardless of the decision.

## Done when

`todo add "X" --project workspace --depends-on slash-usage:1` records the dependency, `todo next --project workspace` holds X back until `slash-usage:1` is done, and `todo check` on a list with an unresolvable foreign reference warns without failing.

## Comments

### @agent at 2026-10-05 02:09:40 +00:00

Done: Diagnosis of check#4 (no code change; recommend one unchanged retry).

FAILED (observed): `MemoryTodoStore without remove conforms to TodoStore > reopen puts the task back at the end of its section`. The assertion is not about reopen. It is the afterEach guard in test/sandbox.ts: "this test wrote outside its temporary directory, into /Users/lemol/.todo-md: ~ cache/2bxygtig92o.json". Log: <attempts>/01M44VF9JG1KFPGZYA72EKSYYX/output.log lines 527-531. 1159 pass, 1 fail.

INVESTIGATED:
- The failing test is the in-memory store's conformance. It does not touch the hub or any cache dir.
- `grep -niE "cache|homedir|\.todo-md"` over `git diff main...HEAD -U0` shows one hit, the pre-existing `cacheDir: path.join(options.home, "cache")` at src/hub/Hub.ts:208. It derives from the home that sandbox.ts replaces with a temp dir, and this branch does not change it.
- The earlier failed check, attempt 01M44TJXRA77BR2HGDVXBSJCR7, had the same escape: `~ cache/2bxygtig92o.json`. It was blamed on a different test, `the git store conforms to TodoStore > cancel makes the task done with outcome cancelled`. The same file escaping under unrelated tests in separate runs fits an outside writer. The sandbox snapshots the real ~/.todo-md before and after each test, so any process writing there during that window is blamed on whichever test is running.
- Live processes on this machine run against the real ~/.todo-md: `bun bin.ts serve` (pid 63697, in another project's web app) and `bun src/cli/bin.ts serve --reload-when-stale` (pid 71097, in another checkout). I did not capture which process wrote the cache file. This is a suspected cause, not proven.
- Focused run: `bun test test/spec` gives 228 pass, 84 skip, 0 fail (includes the Memory conformance suite). The working tree is clean.

NOT proven: that the serve processes wrote the file. Passing in isolation does not establish that either.

CHANGED: nothing. Changing the diff would not address a write from outside the process tree.

COMMANDS FOR THE UNCHANGED RETRY:
- Re-run `bun run check` on the same commit.
- If it fails again on `~/.todo-md/cache/*`, the cause is the live `todo serve` processes or the user's own CLI sharing the real home during the gate. Stop them for the run, or give the gate a TODO_MD_HOME of its own, instead of editing this feature.

Review: approved (5/5)
Approved. All requirements from the task brief and all previous review findings have been resolved, verified with live commands, and thoroughly tested.

#### Previous Review Findings (All Fixed)

1. **Cross-project cycle recursion (review#1 finding 1)**: Fixed in `f6c8d2b`. `showTask` and `listTasks` in `src/hub/dependencies.ts:46-63` call `service.get` / `service.tasks` directly, avoiding derived board re-entry, and `VisitedRef` tracks in-flight evaluations. Bounded termination verified:
   - 2-cycle (`pa:1` <-> `pb:1`), 3-cycle (`pa:1` -> `pb:1` -> `pc:1` -> `pa:1`), and self-cycle (`aa:1` -> `aa:1`) all terminate cleanly, report blocked status and `dependency-cycle` error. Pinned by `detects cross-project cycles without infinite recursion and reports diagnostic` in `test/hub/Hub.test.ts:683-720`.
2. **Unrelated task-36 files (review#1 finding 2, review#2 finding 2)**: Fixed in `a592ddd`. `todo/TODO.md` and `todo/hub-and-sources/36-memoize-...md` were dropped from the diff; `git diff origin/main..HEAD --stat -- todo/` shows only the runner-owned `todo/done/37-*.md`.
3. **Anchor retargeting in `add` (review#2 finding 3)**: Fixed in `a592ddd`. `src/cli/commands/tasks.ts:104` removes `before`/`after` from `projectOfRefs` (matching `mv`), activating the anchor contradiction check at `src/cli/commands/tasks.ts:112-118`. Pinned by `rejects an anchor in another project instead of retargeting` in `test/cli/tasks.test.ts:543-570` (asserts exit code 2, error message `anchor project slash-usage contradicts workspace`, neither list gains the task). Help text at `src/cli/commands/tasks.ts:66-67, 442-443` updated to `(same project only)`.
4. **Padded foreign reference normalization (review#2 finding 4)**: Fixed in `a592ddd`. `parseDependencyId` at `src/markdown/ids.ts:18-25` strips leading zeros from all-digit ID parts (`upstream:01` → `upstream:1`, non-digits like `work:PROJ-07` unchanged). Pinned by `normalizes numeric IDs in qualified dependencies` in `test/markdown/metadata.test.ts:75-80` and `normalizes padded numeric IDs in frontmatter depends_on` in `test/markdown/taskFile.test.ts:286-293`.
5. **Hub design doc contradiction (review#2 finding 5)**: Fixed in `a592ddd`. Stale references at `docs/superpowers/specs/2026-09-13-hub-design.md:416-419` (§CLI) and `:524` (Deferred) updated. Verbatim search for `anchors and dependencies in another project` yields 0 active copies (only historical task description in `todo/hub-and-sources/35-*.md:7`). Verbatim search for `Cross-project dependencies.` yields 0 copies.
6. **Dead `DependencyResolver.unblocked` (review#2 finding 6)**: Fixed in `a592ddd`. Removed from `src/core/resolver.ts` and `src/hub/dependencies.ts`.
7. **Documentation and README tables (review#2 finding 7)**: Fixed in `a592ddd`. `docs/spec.md:209-210` records `unknown-dependency` foreign warning severity; README tables in `src/spec/README.md:22`, `src/core/README.md:22-26`, and `src/hub/README.md:22` document new exports.

---

#### Required Cases and Tests Audit

- **"todo add 'X' --project workspace --depends-on slash-usage:1 records the dependency"**:
  - Pinned: `test/cli/tasks.test.ts:498` (`does not retarget and holds task back until the foreign task is done`). Asserts exit code 0, output `Added 01  Dependent Task`, and metadata contains `["slash-usage:1"]`.
- **"todo next --project workspace holds X back until slash-usage:1 is done"**:
  - Pinned: `test/cli/tasks.test.ts:521-536`. Asserts `next` outputs `Nothing is ready.` while `slash-usage:1` is open, and outputs `workspace:01  Dependent Task` once `slash-usage:1` is completed via `todo done`.
- **"todo check on a list with an unresolvable foreign reference warns without failing"**:
  - Pinned: `test/core/check.test.ts:62-81` (`treats unresolvable foreign dependency as warning, not error`) and `test/hub/Hub.test.ts:722-756` (`hub check warns on unknown foreign ID and unresolvable project`). Asserts 0 errors and warning severity for `unresolvable-project` and `unknown-dependency`.
- **Single expect reversal verification**:
  - Reversed `test/markdown/taskFile.test.ts:270` (`slash-usage:2` → `slash-usage:3`) in a scratch copy. Running `bun test -t 'round-trips qualified foreign dependencies'` failed with `expect(received).toEqual(expected)` receiving `["1", "slash-usage:2"]` vs expected `["1", "slash-usage:3"]`.
- **Anchor contradiction verification**:
  - Pinned: `test/cli/tasks.test.ts:543-570` (`rejects an anchor in another project instead of retargeting`). Tested with both cwd directory (`w`) and `--project workspace` flag; both fail with exit code 2 and `anchor project slash-usage contradicts workspace`.

---

#### "What to Build" Checklist

1. **Parse and render qualified ids in inline and frontmatter `depends_on`, round-tripping unchanged**:
   - Done. Parser in `src/markdown/ids.ts:18-25`, inline parser in `src/markdown/metadata.ts:31`, frontmatter serializer in `src/markdown/taskFile.ts:192-201`, display formatting in `src/cli/render.ts:19-27`.
2. **`ready`/`blocked` across projects through the hub**:
   - Done. `DependencyResolver` service defined in `src/core/resolver.ts:8-28`, integrated in `TodoService.board` at `src/core/TodoService.ts:133-146`, implemented in `src/hub/dependencies.ts:81-106`. Foreign tasks satisfied iff done with `outcome !== "cancelled"`. Unresolvable projects/tasks remain unsatisfied and yield non-blocking warnings.
3. **`check`: `unknown-dependency` for foreign ids, `unresolvable-project` warning, cross-project cycle detection**:
   - Done. Standalone diagnostics in `src/core/check.ts:49-61`, hub resolver diagnostics in `src/hub/dependencies.ts:136-180`, multi-project cycle detection in `src/hub/dependencies.ts:228-271` via `findCrossProjectCycle`.
4. **CLI: `--depends-on <project>:<id>` storage, `show`/`ls` qualified rendering, `todo done other:7` cross-project reporting**:
   - Done. `src/cli/commands/tasks.ts:106-109, 123` (`toStoredId`), `src/cli/render.ts:19-27` (`showId`), `src/cli/commands/tasks.ts:348-378` (`done` remote unblocking).
5. **The retargeting bug fixed**:
   - Done. `src/cli/commands/tasks.ts:104` (`add`), `:233` (`edit`), `:471` (`mv`). Anchor project contradiction errors handled at `:112-118` and `:475-481`.

*Note*: The task brief contains no separate Comments section.

---

#### Performance at Scale Measurement

Measured cross-project dependency evaluation across 200 distinct foreign references using the memory hub probe:
- Command: `bun /tmp/probe-hub/probe.ts scale1 scale`
- Output:
  \```
  scale next: 166ms ready=0
  scale check: 243ms diags=0
  \```
Evaluation completes in under 250ms for 200 foreign dependencies across projects.

---

#### Verification and Hygiene

- **Linter**: `bun x biome check src test` -> `Checked 232 files in 492ms. No fixes applied.` (0 errors, 0 warnings; base had 0).
- **Typecheck**: `bun x tsc --noEmit` -> exit code 0.
- **Focused tests**: Ran 188 tests across 12 touched-area test files (`Hub.test.ts`, `tasks.test.ts`, `check.test.ts`, `metadata.test.ts`, `taskFile.test.ts`, `boundaries.test.ts`, `refs.test.ts`, `TodoService.test.ts`, `query.test.ts`, `help.test.ts`, `render.test.ts`, `parsing.test.ts`) -> 188 pass, 0 fail (597 assertions).
- **Working tree**: Clean, no uncommitted changes, no stray files.

