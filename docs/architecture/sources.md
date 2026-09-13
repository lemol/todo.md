# Sources

> **Status: fs built (task 14).** git (task 19) and jira (task 06) are
> planned; each updates this page. The full design is in the
> [hub design](../superpowers/specs/2026-09-13-hub-design.md#4-sources).

A **source** turns a registry entry into a `TodoStore` (see
[contract.md](./contract.md)) and, when its data is remote, keeps a local
replica fresh. Every project reads from its local replica; `sync` refreshes
it.

| Source | Module | Replica | Sync | Writes |
| --- | --- | --- | --- | --- |
| `fs` | `hub` | the list directory | none | files, as `FsTodoStore` |
| `git` | `src/git` | a partial clone in `projects/<name>/clone` | fetch, `pull --rebase`, push | files, then one commit per mutation and a push |
| `jira` | `src/jira` | `projects/<name>/mirror.json` | fetch the JQL queries | Jira REST, then re-fetch the issue |

## The interface

```ts
type SourceEnv = FileSystem | Path            // provided by the hub

interface Source<C> {
  readonly kind: string
  readonly config: Schema.Codec<C, unknown>
  defaultName?(config: C): string | undefined
  location(config: C): string
  prepare?(p: SourceProject<C>): Effect<void, SourceError, SourceEnv>
  open(p: SourceProject<C>): Layer<TodoStore, SourceError, SourceEnv>
  sync?(p: SourceProject<C>): Effect<SyncOutcome, SyncError, SourceEnv>
  changes?(p: SourceProject<C>): Stream<void, never, SourceEnv>
  status?(p: SourceProject<C>): Effect<Partial<ProjectStatus>, never, SourceEnv>
  beforeRemove?(p: SourceProject<C>, force: boolean): Effect<void, SourceError, SourceEnv>
  owns?(config: C, listRoot: string): Effect<boolean, never, SourceEnv>
}

interface SourceProject<C> {
  readonly name: string
  readonly config: C
  readonly dir: string | undefined  // undefined for unregistered projects
}
```

- The hub provides `FileSystem` and `Path` (`SourceEnv`) to every call, so
  `fsSource` is a plain value. `owns` is an effect because comparing list
  roots reads the disk.
- The hub expands `~` in top-level string fields before `config` decodes
  them.
- A source validates its own config and receives its project's data
  directory, touching nothing else.
- Sources are built at the composition root with their services (for
  example `ChildProcess`, `HttpClient`) already provided, and passed to the
  hub. A frontend that lacks a source still lists those projects, with an
  error status.
- Each source passes `runConformance` for the capabilities it declares.

## Key behaviors

- **fs** watches its list directory (debounced, ignoring `.todo.lock` and
  `*.tmp`) for live changes.
- **git** never fails a mutation because of the network. A rejected push is
  rebased and retried once; otherwise the commit stays local (`ahead`). A
  rebase conflict is aborted and the project marked `diverged`. Credentials
  are the user's git setup.
- **jira** mirrors tickets matching `jql` (default: assigned to me, not
  done) and recently done ones, supports complete, reopen, comment and
  editing title and labels, and declares only the `comments` capability
  (spec §1.5, with `add` and `remove` as capabilities from task 13).
