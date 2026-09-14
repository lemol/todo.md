---
name: todo-md
description: Use when inspecting, selecting, adding, updating, completing, or otherwise managing a Markdown task list that follows the todo.md standard.
---

# Working with todo.md lists

Use the list's CLI for task work. It understands list discovery and preserves
the format's minimal-diff rules better than manual Markdown edits.

## Start with local policy

Read repository guidance (`AGENTS.md`, `CLAUDE.md`, or equivalent) before
touching a list. It may prescribe the list location, source command, required
checks, task-selection workflow, or restrictions on mutations.

## Find the list and CLI

1. If repository guidance specifies a command, use exactly that command.
2. Otherwise, inspect `package.json`. When it defines a `todo` script, use the
   repository's package manager to run it, such as `bun run todo` in a Bun
   project. If there is no script, use the installed `todo` command.
3. Run `<todo-command> --help` before using an unfamiliar command or flag.
4. Let the CLI discover the nearest list. When work must target a particular
   list, pass `--dir <directory-containing-TODO.md>` rather than guessing a
   path or editing a file directly.
5. If discovery fails, report the missing list or command and ask for the
   intended directory. Do not initialize or invent a list unless requested.

## Work with tasks

| Goal | Inspect or change |
| --- | --- |
| Choose work | `next`, then `show <id>` when context or dependencies matter |
| Inspect tasks | `list`, `show <id>`, and command help for filters |
| Add work | `add <title>` with documented placement, tags, dependencies, or description flags |
| Update work | Use the relevant CLI mutation; inspect its help first |
| Finish work | Confirm the task is the intended item, then use `done <id>` |

Treat the CLI result as authoritative for generated IDs and task state. Do not
guess IDs or infer readiness from Markdown order alone.

## Working across projects

Registered projects share one hub: `todo projects` lists them,
`todo projects add <dir>` registers one, `--project <name>` targets one from
anywhere, and task IDs accept `<project>:<id>`. `todo ls --all` and
`todo next --all` span every project; `todo sync` refreshes remotes.

## Verify each mutation

After adding, updating, or completing a task, inspect the affected task with
`show <id>` or list it again. Run the repository's required validation if one
is specified. When working in a repository checkout, review the resulting diff
so only the intended task-list change is present.

## Common mistakes

- Editing `TODO.md` directly when the CLI is available, which can bypass
  repository workflow and format-preserving behavior.
- Running a source command from the wrong directory, so discovery targets a
  different list or no list at all.
- Completing the first visible task without checking `next`, dependencies, or
  repository-specific rules.
- Creating a list merely because discovery failed; ask first unless list
  initialization was requested.
