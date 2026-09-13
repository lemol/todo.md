# Sources

> **Status: planned.** Nothing here is built yet. The full design is in the
> [hub design](../superpowers/specs/2026-09-13-hub-design.md#4-sources).
> Tasks 14 (fs), 19 (git) and 06 (jira) build them; each updates this page
> to match the code.

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
interface Source<C> {
  readonly kind: string
  readonly config: Schema.Codec<C>
  defaultName?(config: C): string | undefined
  location(config: C): string
  prepare?(p: SourceProject<C>): Effect<void, SourceError>
  open(p: SourceProject<C>): Layer<TodoStore, SourceError>
  sync?(p: SourceProject<C>): Effect<SyncOutcome, SyncError>
  changes?(p: SourceProject<C>): Stream<void>
  status?(p: SourceProject<C>): Effect<Partial<ProjectStatus>>
  beforeRemove?(p: SourceProject<C>, force: boolean): Effect<void, SourceError>
  owns?(config: C, listRoot: string): boolean
}
```

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
