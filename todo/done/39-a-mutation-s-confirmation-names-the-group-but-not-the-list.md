---
title: A mutation's confirmation names the group but not the list it wrote to
completed_at: 2026-10-20T03:55:04Z
outcome: completed
---
On 2026-10-16 three tasks for one project were filed into another project's list: the caller's shell had changed directory underneath it, discovery did its job for the directory it was given, and nothing in the output said so. `add` answered "Added 538 Three tabs exhaust the browser's sockets … to Live updates", naming the id and the group but not the project or list root, and it created the `Live updates` group in a list that never had one without a word. The caller noticed only because the ids continued that list's sequence. Every mutation (`add`, `edit`, `done`, `reopen`, `cancel`, `mv`, `rm`, `promote`, `comment`) should name the list it acted on, as the registered project's name when one owns it or the list root otherwise, and `add` should say when it created a group, since a new group is as often a typo or a wrong list as an intention. Agents file tasks through this CLI from whatever directory their shell happens to be in, so the confirmation is the only check they get. Done when: every mutation's confirmation names the project or list root, `add` reports a group it created, and the CLI tests cover both.

## Comments

### @agent at 2026-10-20 03:55:04 +00:00

Done: Both plan tasks implemented test-first, two commits on the run's branch.

Task 1 — every mutation names its list (commit a2e0797 `feat(cli): a mutation's confirmation names the list it wrote to`):
- `src/cli/render.ts`: new `listName(project)` returning the registered name, else `ProjectInfo.location` (the list root).
- `src/cli/context.ts`: new `confirm(project, value, human)` wrapping `output`, so JSON is byte-identical; in human mode it prefixes the first line with `<listName>: ` and passes later lines (`Now ready:`, cancel reason) through.
- `src/cli/commands/tasks.ts`: all nine mutations (`add`, `promote`, `edit`, `done`, `cancel`, `reopen`, `mv`, `rm`, `comment`) now call `confirm`; query commands still call `output`.
- `src/cli/README.md`: new Output bullet documenting the prefix.
- Tests: new `describe("a mutation's confirmation")` in `test/cli/projects.test.ts` runs all nine mutations against registered project `a` plus one unregistered list (`${root}/b`); existing exact-stdout assertions in `tasks.test.ts`, `projects.test.ts` (mem/a) and `bin.test.ts` (asserts `toEndWith("/todo: Added 01  Try it\n")`) updated. The new test failed first with `Received: "Added 04  Four"`, then passed after the change.
- One deviation from the plan draft: none in behavior; `bun run fix` reflowed long lines.

Task 2 — `add` says when it created the group (commit e076d93 `feat(cli): add says when it created the group`):
- `src/cli/commands/tasks.ts`: before `todo.add`, `const group = Option.getOrUndefined(flags.group)` and `created` from an unfiltered `todo.list()` exact-name section match; the human line says `to new group <name>` only when created. README bullet extended.
- Tests: two new cases in `describe("todo add")` — new group then re-add then existing group (`Live updates` x2, `Backend`), and an empty `## Ops` heading counting as existing with ID `01`. First failed with `Received: "... to Live updates"` (no `new group`), then passed.
- Deviation from the plan draft: the draft's `flags.group.value` does not typecheck (narrowing lost inside the closure); I extracted `Option.getOrUndefined(flags.group)` into a `const` first. Also, I initially placed the check after `todo.add` and moved it before, since after the add the group always exists.

Verification (each run separately, to completion):
- `bun test test/cli/tasks.test.ts test/cli/projects.test.ts test/cli/render.test.ts test/cli/help.test.ts` → 53 pass, 0 fail; `bun test test/cli/bin.test.ts` → 2 pass, 0 fail (55 total vs 54-file baseline + 1 new test; task-2 run: 41 pass, 0 fail on the two files).
- `bun run lint` → clean (after `bun run fix` reflow); `bun run typecheck` → clean. The one typecheck failure seen (`flags.group.value` on `None`) was fixed as described above; no other failures observed.
- Focused-test search `grep -rnE "Added 0|Updated 0|Done 0|Moved 0|Removed 0|Commented on|Reopened 0|Cancelled 0|now has its own file" test/`: remaining hits are web flash messages (`test/web/contracts.test.ts`), pure renderers (`render.test.ts`), and `renderPull` (`jira-pull.test.ts`) — none routed through `confirm`, unchanged per plan; the two `toContain` checks still pass as substrings.
- Worktree clean; no files written outside it; no probe links or scratch worktrees left behind. Whole-gate `bun run check` deliberately not run (check stage owns it).

Review: approved (5/5)
Approved. Read the whole diff 70b0bd9..e076d93: src/cli/{README.md,commands/tasks.ts,context.ts,render.ts} and test/cli/{bin,projects,tasks}.test.ts.

Done when, case by case:
1. Every mutation's confirmation names the project or the list root. All nine mutations call `confirm` (`rg -n "output(|confirm("` in tasks.ts shows confirm at lines 169, 208, 312, 402, 441, 475, 570, 604, 641 and no `output(` left). Pinned in test/cli/projects.test.ts, "a mutation's confirmation > names the registered project it wrote to, and any other list by its root": all nine with `a:`, plus the unregistered `${root}/b:`. The existing exact-stdout tests in tasks.test.ts pin the list-root form for each command.
2. `add` reports a group it created. Pinned in tasks.test.ts, "todo add > says when it created the group…" (new, then existing on re-add, then the preexisting Backend) and "does not call an empty group heading new".
3. The CLI tests cover both: yes, above.
Reversal in a scratch worktree (since removed): I forced `created` to false and made `confirm` return the lines unprefixed. That gave 19 fail / 22 pass, including `Received: "Added 06  Three tabs to Live updates"`, `Received: "Added 04  Four"` and `Received: "Added 01  First to Ops"`. The tests fail whenever the behavior is missing.

What to build: the task has no numbered items. Its two requirements are done (above). Comments: I read todo/39-*.md at review time. It has no Comments section, so 0 comments and no authors. The brief has no pre-start comments either. Implementer's stated gaps: `mv --group` also creates groups silently. That was pushed back in the plan as a follow-up, and it is fine: the task asks only that `add` report a created group. Decisions: the brief records none to contradict.

Class checks (probe CLI, scratch HOME/TODO_MD_HOME under the attempt dir):
- `--group "Ops "` is refused by the schema ("no leading or trailing whitespace").
- `--group ops` against `## Ops` gives "Added 01  B to new group ops". Correct: placement matches exactly (FsTodoStore.ts:153 `candidate.name === placement.group`), so `ops` really is a new group.
- `--group Ops` gives "to Ops".
- `--json` output is unchanged (no prefix, no "new").
- `done 2 3` prefixes the first line only ("…/todo: Done 02  C" / "Done 03  E"). That is acceptable: one list per command, via projectOfRefs.
- Not tried: non-fs sources. The registered/unregistered split is source-agnostic (`listName` reads `ProjectInfo.registered`/`location`), and Invalid configs (location "") cannot reach a mutation.

Cost: the extra `todo.list()` runs only when `--group` is given. On 3000 inline tasks in 20 groups, `time add X --quick` took real 0.58/0.40/0.46 and `add Y --group G20 --quick` took 0.54/0.34/0.39, so the difference is not measurable.

Stale copies: `rg "(Added|Moved|Removed|Commented on|Reopened|Cancelled|Done) [0-9]" -g '*.md'` (proven by its hit in src/cli/README.md:89) finds only dated history: docs/superpowers/plans/*, todo/done/hub-and-sources/35-*.md:75, and the task text itself. No live doc quotes the old output. docs/spec.md does not specify CLI confirmations.

Checks:
- Focused tests (tasks, projects, render, help, bin): 57 pass, 0 fail.
- `bun run typecheck`: clean.
- `bun run lint`: oxfmt clean; oxlint "Found 0 warnings and 0 errors"; base had 0.
- check.command `bun run check` passed at e076d93 (check#1: 1320 tests, 97 files).

Commits: a2e0797 and e076d93 are conventional feat(cli) commits, each scoped to one plan task. No new modules, so no colocation question. Worktree is clean.

