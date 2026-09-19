---
title: Add the git source
tags: [adapter, hub]
depends_on: [15]
group: Hub and sources
completed_at: 2026-09-19T16:31:57Z
outcome: completed
---
## Goal

Register a git repository as a project without cloning it yourself: the hub
clones it into `~/.todo-md`, reads from the clone, commits each mutation and
pushes it, and `sync` pulls.

Design: [hub design §4, git](../../docs/superpowers/specs/2026-09-13-hub-design.md#git-srcgit-lemoltodo-mdgit),
[docs/architecture/sources.md](../../docs/architecture/sources.md).

## Scope

In: `src/git` (`@lemol/todo-md/git`) exporting `gitSource`; wiring into the
CLI and web composition roots; `todo projects add` flags `--branch` and
`--list`; tests against local bare repositories.

Out: GitHub API use (everything goes through `git`); per-project credentials;
a progress UI; `fmt`/`init` on git projects.

From task 14's review: `remove` of a broken entry (git source not loaded,
or an invalid config) cannot call `beforeRemove`, so it deletes the data
directory, a clone with possibly unpushed commits, without `force`. Require
`force` when the source cannot be consulted and the data directory is not
empty.

## Design

**Running git.** A small `Git` helper (`src/git/git.ts`) over
`ChildProcess` (`effect/unstable/process`): `git(cwd, args)` returns
stdout, fails with a `GitError { args, code, stderr }`. Every call sets
`GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND="ssh -o BatchMode=yes"` (unless
the user already set `GIT_SSH_COMMAND`), so git never prompts: the CLI must
never block on input. `gitSource` is built by `GitSource.make` (an Effect
needing `ChildProcessSpawner`), so the hub never sees that requirement.

**Config** `{ url, branch?, list? }` (Schema). `defaultName`: the
repository name from the URL without `.git`. `location`: the URL (plus
`#branch` when set).

**Layout.** `<dir>/clone` (the working clone) and `<dir>/.todo.lock` (fs's
`makeLock(dir)`, the clone lock).

**`prepare`**: `git clone --filter=blob:none [--branch <b>] <url>
<dir>/clone`. Failure → `SourceError` with git's stderr (the hub then
removes the directory).

**The list root**: `<clone>/<list>` when `list` is set (must contain
`TODO.md`), else `<clone>/todo` or `<clone>` by the discovery order,
without walking up. Missing → `SourceError`.

**`open`**: a missing clone → `SourceError` ("not cloned; run `todo sync
<name>`"). Otherwise a `TodoStore` that wraps `FsTodoStore` over the list
root:

- Reads delegate unchanged.
- Each mutation (`add`, `update`, `move`, `complete`, `reopen`, `remove`,
  `renameGroup`, `comment`) runs under the clone lock: the fs operation,
  then `git add -A -- <list dir relative to the clone>`, then, if
  `git diff --cached --quiet` reports changes, `git commit -m <message>`.
  Messages: `todo: add 13 - Title`, `todo: edit 07 - Title`,
  `todo: move 07 - Title`, `todo: complete 07 - Title`,
  `todo: reopen 07 - Title`, `todo: remove 07`, `todo: rename group Backend
  to Server`, `todo: comment on 07 - Title`. A commit failure (no git
  identity, hooks) is a `StoreError` carrying git's stderr; the fs change
  stays in the working tree and the next mutation's commit includes it.
- After the lock is released, **push**: `git push origin HEAD:<branch>`
  (branch = config or the current branch). Classify failures from stderr:
  - rejected (`[rejected]`, `non-fast-forward`, `fetch first`):
    `git pull --rebase`, then push once more;
  - a rebase conflict: `git rebase --abort`, record `diverged` (see
    status), stop;
  - unreachable (`Could not resolve host`, `Connection refused`,
    `unable to access`, timeouts) or auth (`Permission denied`,
    `Authentication failed`, 403): stop.

  The mutation's result is returned whatever the push did: **a mutation
  never fails because of the network.** The push outcome is written to
  the project's state as the last error (use a small `GitState` file
  `<dir>/git.json` `{ lastPushError?, diverged? }` read by `status`, since
  `state.json` belongs to the hub).

**`sync`**: missing clone → clone (as `prepare`). Else under the clone lock:
`git fetch origin`; `git pull --rebase` (conflict → `rebase --abort`,
`SyncError` `diverged` with the clone path); if ahead, push (failures →
`SyncError` `offline`/`auth`/`rejected`). Summary: `pulled N commits,
pushed M` / `up to date`. Success clears `git.json`.

**`status`**: `git rev-list --left-right --count HEAD...@{u}` →
`{ ahead, behind }` (behind is as of the last fetch), plus `diverged` and
the last push error from `git.json`.

**`changes`**: the hub's `watchList` over the list root (the `.git`
directory is outside it unless the list is the clone root; then filter out
`.git/`).

**`beforeRemove(p, force)`**: refuse with `SourceError` ("N unpushed
commits; use --force") when `ahead > 0` and not `force`.

**Wiring.** `src/cli/bin.ts` and `src/web/server.ts` add
`gitSource` to `sources` (providing Bun's `ChildProcessSpawner` through
`BunServices`). `todo projects add` gains `--branch` and `--list` (with
descriptions and an example), passed into the git config; they are usage
errors with a non-git source. The web add form gains optional branch and
list fields shown for git targets.

## Files

- New: `src/git/index.ts`, `git.ts`, `GitSource.ts`, `store.ts`,
  `push.ts`, `README.md`
- `package.json` exports `"./git"`
- `test/boundaries.test.ts`: `git: { modules: ["spec", "fs", "hub"],
  packages: ["effect"] }` + checker cases; web may import
  `@lemol/todo-md/git`
- `src/cli/bin.ts`, `src/cli/commands/projects.ts`, `src/web/server.ts`,
  web projects form
- `test/git/*.test.ts`

## Tests

All against temporary directories with a bare repository as the remote
(`git init --bare`, seeded with a list and pushed from a scratch clone);
set `user.name`/`user.email` in each repository's local config, never
globally. `git` is available in CI (ubuntu-latest).

- `runConformance("git", layer)` over a prepared clone.
- Each mutation makes exactly one commit with the expected message and
  pushes it (the bare repo's log shows it).
- Another clone pushes first → our push is rejected → rebase → pushed.
- Conflicting edits to the same line → rebase aborted, `diverged` in
  status, the mutation's result returned, the clone left clean (no
  rebase in progress).
- Remote unreachable (point `origin` at a missing path) → mutation
  succeeds, `ahead 1`, last error recorded; a later `sync` after restoring
  the remote pushes it and clears the error.
- `sync` pulls remote changes; `status` ahead/behind; `beforeRemove`
  refuses while ahead and allows with force.
- `open` without a clone → `SourceError`; `sync` clones it.
- `GIT_TERMINAL_PROMPT=0` is set (assert on the spawned environment via a
  test spawner).
- CLI e2e: `todo projects add <file:// url>` clones; `todo --project x
  add …` commits and pushes.

## Docs

- `src/git/README.md`; `docs/architecture/sources.md` git section (drop
  "planned" for git); module table row in `docs/architecture/README.md`;
  root `README.md` package table and a git example in "Using the CLI".

## Done when

- A git project can be added, read, mutated (commit + push), synced and
  removed from the CLI and the web app.
- `bun run check` passes, with no network access in tests.
