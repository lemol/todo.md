---
title: "Expose task promotion: promote command and add/edit --file"
completed_at: 2026-09-18T17:59:25Z
---
Spec §2.9 defines promotion as a first-class operation and says writers MAY promote "on request", but nothing exposes it. `grep -rni promote src` returns nothing, and the only code path that creates a task file for an inline task is `comment` (`src/fs/FsTodoStore.ts:423`, "An inline task, or a link to a missing file: (re)write the file with the comment"). So the only way to get a file-backed task today is to attach a comment you do not want.

Encountered in `lemol/ui`: five planning tasks with long descriptions had to be hand-written to reach the §2.8 layout, because `add --description` leaves everything inline and `TODO.md` stops being scannable.

## Options

- `todo promote <id>` — explicit, mirrors the spec operation, and reads well.
- `--file` on `add` and `edit` — creates the task file-backed in one step, which is the more common need.

Both are worth having: `add --file` for new long tasks, `promote` for existing inline ones.

## Most of the machinery exists

`taskPath` already computes `<tasks_dir>/<group-slug>/<id>-<title-slug>.md`, `groupDir` already handles group moves, and `writing.ts`'s `itemLinesFor` already emits linked items. The `comment` path already performs a promotion end to end, so this is largely a matter of exposing it without the comment.

## Design question for the planner

Promotion is a property of the Markdown/file-system representation, not of the adapter-agnostic model — a Jira-backed store has no notion of task files. So it probably does not belong on the `TodoStore` contract or in `runConformance`; it looks like an `fs` adapter concern plus CLI surface. Decide that before writing code, since it determines whether the conformance suite and capabilities need touching.

## Also consider

Spec §2.9 says writers do not demote file-backed tasks automatically. An explicit demote is not required by this task; decide whether to include it.
