---
title: Support dependencies on tasks in other projects
tags: [hub, spec]
---
A task in one list often waits on a task in another. On 2026-10-02, filing work that waits on `slash-usage:01` and `slash-usage:07` from the workspace, nzila and xonton lists failed: `todo add … --project workspace --depends-on slash-usage:01` says "task project slash-usage contradicts --project workspace", and with `--dir` it says "use --project or --dir, not both". The dependency ended up as bold prose in each description, which `ready`/`blocked` can't see.

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
