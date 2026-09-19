# git

`@lemol/todo-md/git`. A list that lives in a git repository, as a hub source.
The hub clones the repository into the project's own directory, reads from
that clone, commits every mutation and pushes it; `todo sync` pulls.

The behavior is specified in the
[hub design, §4 git](../../docs/superpowers/specs/2026-09-13-hub-design.md#git-srcgit-lemoltodo-mdgit);
[docs/architecture/sources.md](../../docs/architecture/sources.md) puts it next
to the other sources.

## Building it

`gitSource` needs to run `git`, so it is built where a `ChildProcessSpawner`
is available and passed to the hub as a plain value:

```ts
const gitSource = yield* GitSource.make({ env: process.env })
Hub.layer({ home, userHome, sources: [fsSource, gitSource] })
```

`env` is read for one thing only: a `GIT_SSH_COMMAND` the user already set is
left alone. Otherwise every call runs with `GIT_TERMINAL_PROMPT=0` and ssh in
batch mode, because a CLI that stops for a password nobody can type hangs
forever. Credentials are the user's own git setup; nothing is stored here.

## Config

```yaml
projects:
  mionso:
    source: git
    url: git@github.com:lemol/mionso.git
    branch: main        # optional; the repository's own by default
    list: docs/todo     # optional; `todo/` then the repository root by default
```

## Layout

```
<home>/projects/<name>/
  clone/        the working clone (`--filter=blob:none`)
  .todo.lock    the clone lock
  git.json      the last push failure, and whether a rebase conflicted
  state.json    the hub's, not ours
```

## Files

| File | What it holds |
| --- | --- |
| `git.ts` | `makeGit`: running `git` over `ChildProcessSpawner`, and `GitError` |
| `GitSource.ts` | `GitConfig` and the `Source`: prepare, open, sync, status, changes, beforeRemove |
| `store.ts` | the `TodoStore` wrapper: one commit per mutation, then a push |
| `push.ts` | pushing, classifying git's stderr, and `git.json` |

## What a mutation does

Under the clone lock: the file-system operation, `git add -A -- <list>`, and a
commit, unless nothing was staged. Then, with the lock free, a push.

Commit subjects name the operation and the task, so the history reads as a
log of the list:

```
todo: add 13 - Ship it
todo: edit 07 - Rework auth
todo: move 07 - Rework auth
todo: complete 07 - Rework auth
todo: cancel 07 - Rework auth
todo: reopen 07 - Rework auth
todo: promote 07 - Rework auth
todo: remove 07
todo: rename group Backend to Server
todo: comment on 07 - Rework auth
```

**A mutation never fails because of the network.** A rejected push is rebased
and retried once; a conflicting rebase is aborted and the project marked
`diverged`; anything else leaves the commit local. Each outcome is written to
`git.json` and reported by `status` as `ahead` and an error. Only a failed
*commit* — no git identity, a hook that refuses — is a `StoreError`, and even
then the files are already written, so the next mutation's `git add` picks
them up.

## What it does not do

No GitHub API, no stored tokens, no progress UI, and no `todo init` or
`todo fmt` on a git project.
