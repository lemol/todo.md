# @lemol/todo-md-fs

The reference `TodoStore` adapter. It stores a todo.md list as a directory of
Markdown files, exactly as described in
[spec Part 2](../../docs/spec.md#part-2-the-todomd-format).

> Status: scaffolded, not implemented yet.

## Contents

| Export                     | What it is                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `FsTodoStore.layer({ root })` | A `TodoStore` over the list at `root`. Requires Effect's `FileSystem` and `Path`.  |
| `FsTodoStore.normalize()`  | Normalizes the list on request (spec §2.11). Backs `todo fmt`.                        |
| `findListRoot(cwd)`        | Discovery: walks up from `cwd`; at each level `todo/TODO.md` wins over `TODO.md`.     |
| `initList(dir, options)`   | Creates a new list (`TODO.md` with a title). Backs `todo init`.                       |

Capabilities: `groups`, `reorder`, `renameGroup` and `comments`, i.e. all of
them.

## Write path

Every mutation runs:

```
lock → read → parse → normalize → edit → write (crash-safe order) → unlock
```

- **No cache.** Every operation re-reads from disk, so hand edits are always
  seen.
- **Atomic files.** Writes go to a temporary file, then rename over the
  original.
- **Lock.** `<root>/.todo.lock` is created exclusively for the duration of a
  mutation, and a stale lock is taken over after a timeout. Reads never lock.
- **Crash safety.** Multi-file operations follow the order in spec §2.10, so
  an interruption leaves a state that normalization repairs.

## Testing

- `runConformance(FsTodoStore.layer(...))` against temporary directories.
- Scenario tests: hand edits between operations, interrupted completion,
  concurrent mutations and the lock.

## Depends on

- [`spec`](../spec)
- [`markdown`](../markdown)
- `effect` (`FileSystem`, `Path`)

## Not here

- Parsing and text edits: see [`markdown`](../markdown).
- Readiness and validation: see [`core`](../core).
