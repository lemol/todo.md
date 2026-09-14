---
title: Run the CLI on the hub with projects and sync commands
tags: [cli, hub]
depends_on: [15]
group: Hub and sources
completed_at: 2026-09-14T04:25:35Z
---
## Goal

Make `todo` work across projects: `--project`, qualified task references,
`todo projects …`, `todo sync`, and `ls`/`next --all`, with all existing
commands running through the hub. Unregistered lists keep working exactly
as today.

Design: [hub design §6, CLI](../../docs/superpowers/specs/2026-09-13-hub-design.md#cli).

## Scope

In: CLI composition through the hub with `fsSource`; the new flag,
commands and output; post-mutation status warnings.

Out: git and jira flags on `projects add` and their sources' wiring (tasks
19 and 06 add them); `init`/`fmt` for non-fs sources.

From task 14's review: unregistered projects are keyed by the raw path, so
`--dir app` and discovery of `app/todo` can yield two projects for one
list, and `--dir` at a directory with no list adds a phantom project that
fails only in `todo()`. `--dir` goes through `fsSource`, which prefers
`<dir>/todo/TODO.md`. `fsSource.owns` compares paths textually, so
symlinks (`/tmp` vs `/private/tmp`) don't match. `projectInput` leaves
`~alice/app` relative to `cwd` and treats `HTTPS://…` as fs.

From task 15: `syncAll` returns `(SyncResult | SyncFailure)[]` where
`SyncFailure` is `{ project, error: string }` (told apart with `"error" in
outcome`) and fails only with `RegistryError` if the registry cannot be
read.

## Design

**Composition.** `CliContext` gains `home` (from `$TODO_MD_HOME`, else
`<userHome>/.todo-md`) and `userHome`; `bin.ts` fills them from `env` and
`os.homedir()`, tests pass temporary directories. `main` provides
`Hub.layer({ home, userHome, sources: [fsSource] })` over `BunServices`.

**Resolution.** `listRoot`/`withTodo` in `src/cli/context.ts` become:
reject `--project` with `--dir` (usage error, exit 2); `hub.resolve({
project, dir, cwd })`; `hub.todo(name)`. `withTodo` passes the resolved
`ProjectInfo` to its callback too, for output.

**`--project <name>`**: a `GlobalFlag.setting("project")` with a
description, like `--dir`.

**Qualified references.** Every task-ID argument and the flags
`--depends-on`, `--before`, `--after` accept `project:id` (`parseRef`):

- an ID argument's project selects the project when `--project` is absent;
- a project that differs from `--project` or from the command's other
  references is a usage error;
- `--depends-on`, `--before` and `--after` must be in the same project as
  the task (cross-project dependencies are out of scope).

Keep `taskId`'s leading-zero stripping for the ID part.

**New commands** (in `src/cli/commands/projects.ts`; each with a
description, flag and argument descriptions, and examples, as
`test/cli/help.test.ts` requires):

| Command | Behavior |
| --- | --- |
| `todo projects` / `todo projects ls` | One line per project: name, source, location, open and ready counts (from `overview` with no filter), status (`synced 3h ago`, `never synced`, `error: …`, `ahead 1`, `diverged`). Unregistered current project shown with `(not registered)`. |
| `todo projects add <target> [--name] [--source]` | `projectInput(target, …)` then `hub.add`. Prints the project line. |
| `todo projects rm <name> [--force]` | `hub.remove`. |
| `todo projects rename <from> <to>` | `hub.rename`. |
| `todo sync [<name>…] [--all]` | No names and no `--all`: the current project. One line per project (`mionso: pulled 3 commits, pushed 1`, `todo-md: nothing to sync`, `work: error (auth): …`). Exit 1 if any failed. |
| `todo ls --all`, `todo next --all` | `overview` over every registered project (`--all` conflicts with `--project`/`--dir`). Human output: a `# <project>` heading per project, then the usual rendering with qualified IDs; error entries render as `# <project>` + `error: …`. |

**Post-mutation warnings.** After a successful mutation on a project whose
`ProjectInfo.syncable` is true, read `hub.status(name)`; if `ahead > 0`
print `todo: not pushed (ahead N): <last error>` to stderr, if `diverged`
print `todo: <name> has diverged; resolve it in <location>`. Exit code
stays 0. (Only git sets these; this task tests it with `memorySource`.)

**JSON.** Existing `--json` results keep their shape plus a `project`
field (the project name). `projects`, `sync` and `--all` print their
structures as JSON (`ProjectInfo[]`, `SyncResult | SyncFailure`,
`Overview`).

**`init` and `fmt`** stay fs-only: with `--project` naming a non-fs project
they are usage errors. `init` never registers the new list; the message
suggests `todo projects add .`.

**Errors** (`src/cli/errors.ts`): map `ProjectNotFound`,
`InvalidProjectConfig`, `SourceUnavailable`, `SourceError`,
`RegistryError`, `SyncError` to messages and exit code 1.

## Files

- `src/cli/bin.ts`, `main.ts`, `context.ts`, `errors.ts`, `render.ts`
- `src/cli/commands/projects.ts` (new), `commands/query.ts`,
  `commands/tasks.ts`, `commands/lists.ts`
- `src/cli/README.md`
- `test/boundaries.test.ts`: `cli` may import `hub`
- `test/cli/*.test.ts`, `test/cli/help.test.ts`

## Tests

End to end with `--json` against a temporary `$TODO_MD_HOME` and temporary
lists:

- Every existing CLI test still passes unchanged (unregistered lists).
- `projects add <dir>` → `projects` lists it; `--name` override; duplicate
  name fails; `rm`, `rename`.
- From an unrelated cwd: `todo --project a ls`, `todo done a:3`; mismatch
  between `--project` and a ref is exit 2; `--project` with `--dir` is
  exit 2.
- cwd inside a registered project shows that project's name in JSON.
- `ls --all` and `next --all` across two projects, one broken (its path
  deleted) → an error entry, exit 0.
- `sync` with a memorySource whose sync fails → exit 1 and the message.
- Post-mutation warning with a memorySource reporting `ahead: 1`.
- The help test covers `projects` and `sync`.

## Docs

- `src/cli/README.md`: new flag, commands, examples.
- `docs/architecture/frontends.md`: the cli section describes the hub
  wiring (drop "Planned (task 16)").
- Root `README.md` "Using the CLI": a multi-project example.
- `skills/todo-md/SKILL.md` (the agent skill): mention `--project`,
  qualified references and `todo projects`.

## Done when

- The CLI runs everything through the hub; behavior for unregistered lists
  is unchanged.
- `bun run check` passes.
