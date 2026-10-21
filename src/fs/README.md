# @lemol/todo-md/fs

The reference `TodoStore` adapter. It stores a todo.md list as a directory of
Markdown files, exactly as described in
[spec Part 2](../../docs/spec.md#part-2-the-todomd-format), and passes the
same conformance suite as `MemoryTodoStore`.

> Status: implemented for spec 0.1.

## Contents

| Export | What it is |
| --- | --- |
| `FsTodoStore.layer({ root, lock?, cacheDir? })` | A `TodoStore` over the list at `root`, the absolute path of the directory holding `TODO.md`. Requires Effect's `FileSystem` and `Path` (e.g. `BunServices.layer`). All capabilities. `cacheDir` keeps parsed task files between processes (below). |
| `FsTodoStore.normalize(root, lock?)` | Normalizes the list on request (spec §2.11) and returns a `NormalizeReport` (`assigned`, `finished`, `swept`). Backs `todo fmt`. |
| `findListRoot(cwd)` | Discovery: walking up from `cwd`, the first level with `todo/TODO.md` or `TODO.md` (in that order) is the list. Returns an `Option`. |
| `initList(dir, { title, description? })` | Creates a list (`TODO.md`), creating `dir`. Fails if `dir` already has one. Backs `todo init`. |
| `makeLock(root, options?)`, `Lock`, `defaultLockOptions`, `lockFile` | The advisory lock every mutation takes: `<root>/.todo.lock`, created exclusively. Defined in `spec` so `jira` can take it too, and re-exported here so the hub (its registry) and the git source (its clone) keep reaching it through `fs`. `lockFile` is the name, for watchers that ignore it. |
| `LockOptions` | `timeout` (default 10 s), `staleAfter` (30 s), `retryEvery` (50 ms). |

## Reads and writes

- **Reads never write.** `load`, `get`, `listDone` and `diagnostics` read a
  snapshot of the list: `TODO.md`, the linked task files, the done
  directory, and the file names in the tasks directory and its group
  directories. Hand-edited state (a missing ID, a ticked box, stale link
  text, an interrupted completion) is reported as diagnostics.
- **Every mutation runs the same pipeline:**

  ```
  lock → normalize (spec §2.11) → read a snapshot → edit → write files → unlock
  ```

- **A snapshot is reused while a stat pass says nothing changed.** A read
  first compares `TODO.md`'s text whole, the file names in the done and task
  directories, and each task file's size, inode and modification time with
  the last read's; only when something differs does it open the task files
  again. Hand edits made between commands are still seen: an edit changes
  one of those, and the store's own writes count too. A host that reads on
  every request (the hub, a web app) pays a few milliseconds per read instead
  of a read of every file.
- **Parses are cached by content** (`parsing.ts`). A task file whose path and
  text are unchanged reuses its last parse: in memory for the store's
  lifetime, and in `<cacheDir>/<hash of root>.json` between processes, keyed
  by its path, its length and `Bun.hash` of its text. Only
  an identical text hits, so the cache never needs invalidating; a missing or
  unreadable cache file is ignored. A save also removes the cache files of
  lists whose root no longer exists (a removed worktree, say), so the cache
  directory does not grow without bound. Bump `taskFileParserVersion` when
  `parseTaskFile`'s output changes.
- **Atomic files.** Each write goes to a temporary file, then is renamed over
  the original.
- **Lock.** `<root>/.todo.lock` is created exclusively for the duration of a
  mutation, so concurrent processes (typically agents) cannot lose each
  other's writes. A lock older than `staleAfter` was left by a crashed
  process and is taken over.
- **Crash safety.** Multi-file operations follow the order in spec §2.10. For
  `complete` and `reopen`, the done file is the commit point, so an
  interrupted operation is finished or rolled back by the next change.
- **Promotion.** `promote` writes the task file at its conventional path and
  splices a linked item over the inline one (spec §2.9). A task that already
  has a file, and a done task, are left untouched. There is no demote.

## Diagnostics it adds

On top of the text-only diagnostics from [`markdown`](../markdown), a
snapshot reports:

- `broken-link`
- `orphan-file`: task files directly in the tasks directory or in a group
  directory; other directories are not scanned
- `interrupted-completion`
- `duplicate-id`: across items, and between items and done files

## Testing

- **Conformance:** `test/fs/conformance.test.ts` runs the conformance suite on
  real temporary directories.
- **Exact output:** the other tests pin exact file contents after each
  operation.
- **Other areas covered:** hand edits, diagnostics, recovery, the lock
  (including concurrent stores on one directory), discovery and
  configuration.

## May import (enforced by `test/boundaries.test.ts`)

- [`spec`](../spec)
- [`markdown`](../markdown)
- `effect` (`FileSystem`, `Path`, `Clock`, `DateTime`)

## Not here

- Parsing and text edits: see [`markdown`](../markdown).
- Readiness and validation queries: see [`core`](../core).
