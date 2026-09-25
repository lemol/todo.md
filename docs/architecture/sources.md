# Sources

> **Status: fs, git and jira built (tasks 14, 15, 19, 06 and 24).** The full
> design is in the
> [hub design](../superpowers/specs/2026-09-13-hub-design.md#4-sources).

A **source** turns a registry entry into a `TodoStore` (see
[contract.md](./contract.md)) and, when its data is remote, keeps a local
replica fresh. Every project reads from its local replica; `sync` refreshes
it.

| Source | Module | Replica | Sync | Writes |
| --- | --- | --- | --- | --- |
| `fs` | `hub` | the list directory | none | files, as `FsTodoStore` |
| `git` | `src/git` | a partial clone in `projects/<name>/clone` | fetch, `pull --rebase`, push | files, then one commit per mutation and a push |
| `jira` | `src/jira` | `projects/<name>/mirror.json` | fetch the JQL queries | Jira REST, then re-fetch the issue into the mirror |

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

- **fs** watches its list directory via `watchList(root)` (debounced 100 ms,
  ignoring `.todo.lock` and `*.tmp`) for live changes; `watchList` is also
  exported for the git source. Its `changes` stream runs only while the hub's
  `changes` stream has subscribers.
- **git** never fails a mutation because of the network. A rejected push is
  rebased and retried once; otherwise the commit stays local (`ahead`). A
  rebase conflict is aborted and the project marked `diverged`. Credentials
  are the user's git setup, reached by running `git` itself with prompting
  off, so the CLI never stops for input. It records its own outcomes in
  `projects/<name>/git.json`, next to but separate from the hub's
  `state.json`. See [src/git/README.md](../../src/git/README.md).
- **jira** mirrors tickets matching `jql` (default: assigned to me, not
  done) and recently done ones into one JSON file, so every read is local and
  works offline; `sync` replaces it, and only once both queries succeeded. A
  project needs a name, since one site holds them all, and the API token is
  resolved per call from `token_env` or `token_command` and never stored.
  Complete, reopen, comment and editing the title and labels go straight to
  Jira, then re-fetch the issue and patch it into the mirror under
  `.todo.lock`, so a sync running alongside keeps the change. It declares
  `comments` and no other capability (spec §1.5): without `add` and `remove`
  it never creates or deletes an issue, without `edit` it changes only the
  title and labels, and without `commentAuthor` Jira's own user signs every
  comment. See [src/jira/README.md](../../src/jira/README.md).
