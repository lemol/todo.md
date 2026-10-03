# @lemol/todo-md/cli

The `todo` command: manage a todo.md list from a terminal or from an agent.
Built with `effect/cli` on `@effect/platform-bun`.

> Status: implemented for spec 0.1.

## Install

- **As a dependency:** `@lemol/todo-md` declares `bin: { todo: ./src/cli/bin.ts }`,
  so `todo` is on the path in `node_modules/.bin` (for example `bunx todo`).
- **From a checkout:** `bun link` in this repository makes `todo` available
  globally.
- **Without installing:** `bun src/cli/bin.ts <command>`.

Every command has `--help` (or `-h`) with a description, every flag, and
examples. `todo --help` lists the commands.

## Commands

| Command | Does | JSON result |
| --- | --- | --- |
| `todo` | Same as `todo list` | listing |
| `todo list` / `ls` | Open tasks by group, what blocks them, and a summary. Filters: `--tag` (repeatable), `--assignee`, `--group`, `--ready`, `--blocked`; `--done` for done tasks, `--all` for both. | `{ title, description, sections: [{ name?, description, tasks: TaskView[] }], done: TaskView[] }` |
| `todo next` | The ready task(s) to work on next, in priority order. `--limit n` (default 1, 0 for all) and the `list` filters. | `TaskView[]` |
| `todo show <id>` | A task: state, description, dependencies, the tasks it blocks, comments. | `{ view: TaskView, dependencies: [{ id, title?, state }], blocks: TaskView[] }` |
| `todo add <title…>` | Add a task, in its own file. Decide where it goes (`--group` or `--no-group`) and what it is (`--description` or `--no-description`), or say `--quick` for neither. Also `--inline`, `--file`, `--tag`, `--assignee`, `--depends-on`, `--before`, `--after`. | the `Task` |
| `todo edit <id>` | Change a task: `--title`, `--description`, `--file`, `--tag`/`--untag`, `--assignee`/`--unassign`, `--depends-on`/`--drop-dependency`. | the `Task` |
| `todo done <id…>` | Complete tasks and list those that became ready. | `[{ task, unblocked: TaskView[] }]` |
| `todo reopen <id>` | Reopen a done task at the end of its group. | the `Task` |
| `todo cancel <id> --reason <text>` | Abandon a task: it moves to `done/` recorded as cancelled, with the reason, and satisfies no dependency. | the `Task` |
| `todo mv <id>` | Move a task: one of `--top`, `--bottom`, `--before <id>`, `--after <id>`, `--group <name>`, `--ungrouped`. | the `Task` |
| `todo rm <id>` | Delete a task and its file; `--force` if open tasks depend on it. | `{ removed: id }` |
| `todo promote <id>` | Move an inline task into its own file, leaving a link; does nothing if it has one. | the `Task` |
| `todo comment <id> <text…>` | Add a comment; `--author`. | the `Comment` |
| `todo check` | Validate the list; exits 1 when it finds errors. | `Diagnostic[]` |
| `todo init [dir]` | Create a list (default `./todo`); `--title` (default: the directory's name). | `{ root }` |
| `todo fmt` | Normalize a hand-edited list: number new items, complete ticked ones, sync link text. | `{ assigned, finished, swept }` |
| `todo projects` | Registered projects with sync status; `ls`, `add <target> [--name] [--source] [--branch] [--list]`, `rm <name> [--force]`, `rename <from> <to>`. `--branch` and `--list` are git-only. | `ProjectInfo[]` |
| `todo sync [names…] [--all]` | Sync projects with their remotes; exits 1 when any sync failed. | `(SyncResult \| SyncFailure)[]` |
| `todo web [--port] [--host]` | Start the local web UI over the current list (`--port` default 4400, next free when busy; `--host` default 127.0.0.1). | `{ url }` |

`todo list` and `todo next` take `--all` for every registered project at once
(each under a `# <project>` heading with qualified IDs); with no registered
projects `--all` means open and done tasks, or every ready task, of the
current list.

Where it helps, arguments are forgiving:

- IDs may be typed as shown (`07`) or bare (`7`), or qualified with their
  project (`acme:07`) to work on another project from anywhere.
- A title or comment made of several words doesn't need quotes: `todo add Fix the bug --quick`.
- `--description -` reads the description whole from stdin, so quotes,
  backticks and `$(…)` reach the task verbatim instead of being run by the
  shell: `todo add "Record the cause" --group Ops --description - <<'EOF'`.
  `todo cancel --reason -` and a `todo comment` whose text is a lone `-`
  (`todo comment 3 - <<'EOF'`) read stdin the same way. A dash among other
  words stays a dash.

A `TaskView` is `{ task, state: "ready" | "blocked" | "done", blockedBy: id[] }`;
see [`core`](../core).

## Global flags

| Flag | Meaning |
| --- | --- |
| `--json` | Print the result as one line of JSON on stdout. Failures print `{ "error": { tag, message, … } }` on stderr. |
| `--dir <path>` | The list's directory (the one holding `TODO.md`). Default: walking up from the working directory, the first `todo/TODO.md` or `TODO.md`. |
| `--project <name>` | The registered project to work on, from any directory. Cannot be used with `--dir`. |

The project registry lives in `$TODO_MD_HOME` (default: `~/.todo-md`).
`todo projects add <dir>` registers a list; `--project` and `<project>:<id>`
then reach it from anywhere.
| `--help`, `-h` | Help for the command. |
| `--version` | The version. |

A comment's author comes from `--author`, then `$TODO_MD_AUTHOR`, then the OS
user name.

## Output

- **Human output** mirrors `TODO.md`: sections as headings, one line per task
  (`ID  title  #tags @assignee`), a `blocked by …` line under blocked tasks,
  and a summary.
- **Colors** are used only on a terminal, and never when `NO_COLOR` is set.
- **JSON output** is the command's result exactly, with dates as ISO 8601
  strings. Results from a registered project gain its name as `project`;
  unregistered lists print exactly what they always did.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | The operation failed (no such task, invalid input, no list found, …) or `check` found errors. The reason is on stderr. |
| 2 | Usage error: an unknown command, a bad flag, or flags that contradict each other. |

## For agents

- **Scriptable output.** Use `--json` on every command, and read stdout only
  when the exit code is 0.
- **What to work on.** `todo next --json` returns the highest-priority ready
  task. `todo done <id> --json` reports what that unblocked.
- **Hand edits are safe.** Agents may edit `TODO.md` and task files directly;
  the next command normalizes them.
- **Concurrent writes are safe.** Commands from several agents at once
  serialize through the list's lock.

## Structure

| File | Responsibility |
| --- | --- |
| `bin.ts` | The executable: passes the process's arguments, working directory, environment and TTY state to `main`, and sets the exit code. |
| `main.ts` | The command tree (`todo`) and `main(args, context)` → exit code. |
| `context.ts` | `CliContext`, the global flags, hub resolution, `withTodo` (the current project through the hub), output, author. |
| `commands/*.ts` | The commands: `query` (list, next, show, check), `tasks` (add … comment), `lists` (init, fmt), `projects` (projects, sync), `web` (serve the local web UI). |
| `render.ts`, `style.ts` | Human output, including overview, project and sync lines. |
| `errors.ts` | CLI errors, their messages and exit codes. |

## Testing

- **End to end:** `test/cli` runs `main` against temporary lists and checks
  exact stdout, stderr and exit codes.
- **Help:** `help.test.ts` walks every command from `todo --help`, so a new
  command without a description, examples or described flags fails it.
- **The real executable:** `bin.test.ts` runs it as a separate process.

## May import (enforced by `test/boundaries.test.ts`)

- [`core`](../core)
- [`fs`](../fs)
- [`git`](../git)
- [`hub`](../hub)
- [`spec`](../spec)
- [`web`](../web) (`startServer` for `todo web` only)
- `effect`
- `@effect/platform-bun`
- `node:*` and `bun`

The CLI is the composition root: it builds a hub over `fsSource` and the
[git source](../git) — which needs Bun's `ChildProcessSpawner`, so `bin.ts`
builds it — and runs every command through it.
