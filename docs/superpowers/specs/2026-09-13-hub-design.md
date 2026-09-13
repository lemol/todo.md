# Hub and sources design

Today every frontend is scoped to one list directory, and the web app carries
logic of its own (`apps/web/watch.ts`, its store wiring) that a TUI would
have to rewrite. This design adds **`hub`**: an in-process library (an SDK,
not an API server) that every frontend uses to reach **projects**. A project
is a registered todo list backed by a **source**: a local directory (fs), a
git repository cloned on demand (git), or Jira tickets (jira).

The living reference for what is built lives in
[`docs/architecture/hub.md`](../../architecture/hub.md) and
[`docs/architecture/sources.md`](../../architecture/sources.md). This
document records the decisions, their reasons and the task breakdown.

## Goals

- **One place for project logic.** The CLI, the web app and a future TUI
  share registry, resolution, sync, change notification and cross-project
  queries. Frontends only present.
- **Many projects.** Handle the todos of every repository from anywhere:
  `todo --project <name>`, defaulting to discovery from the working
  directory. The web app (and later the TUI) shows every registered project
  in one dashboard with filters.
- **Remote sources.** A git repository you haven't cloned, and your Jira
  tickets, work like local lists: read locally, refresh with `sync`.
- **Nothing changes for unregistered lists.** Discovery, `--dir` and agents
  in a repository work as today.

## Non-goals

- A daemon or HTTP API. Each process creates its own hub over shared state
  in `~/.todo-md`.
- Multi-user hosting and authentication (task 09 builds on this later).
- Cross-project dependencies.
- Watching remote sources. Remote data refreshes on `sync` only.
- A global content index or search database (see Decisions).

## Decisions

| Decision | Chosen | Alternatives and why not |
| --- | --- | --- |
| Module name | `hub` (`@lemol/todo-md/hub`) | `server-core` suggests an HTTP server, yet the CLI uses it too; `workspace` collides with Bun workspaces and `lemol-workspace`; `projects` reads badly for sync and queries. |
| How sources plug in | **Injected**: the hub defines a `Source` interface; apps pass `sources: [fsSource, gitSource, jiraSource]` | Hub importing every adapter makes a closed set and loads everything everywhere. No abstraction makes each frontend rewire stores and sync per project, the duplication the hub exists to remove. |
| Registration | **Explicit registry** in `~/.todo-md/projects.yaml`, managed from the CLI and the web app | Auto-registering on use fills the registry with throwaway lists. Scanning root directories is slow and names are implicit; it can be added on top later. |
| Reading remote data | **Local replica + explicit `sync`**: the directory (fs), the clone (git), a JSON mirror (jira) | Reading live from remotes is slow, rate-limited and offline-hostile. |
| SQLite | **Not now.** Jira's mirror and sync state are JSON files | Mirrors are small (tens to hundreds of tickets) and disposable: Jira is the source of truth, so switching to SQLite later is a re-sync, not a migration. A global SQLite index would go stale on every hand edit of `TODO.md`. Revisit when cross-project search needs SQL. |
| Git mutations | **Commit per mutation, then try to push** | Push-on-sync hides changes from other machines and agents until you sync. Batching into one commit leaves uncommitted work in a hidden clone. |
| Jira scope | **Mirror plus daily actions**: complete, reopen, comment, edit title and labels | Read-only is too little to be useful; full two-way needs Markdown → ADF writing and issue deletion, the risky parts. |
| `add` and `remove` | **Become capabilities** (spec §1.5) | Jira shouldn't create or delete issues from here; the spec currently makes both mandatory. |

## 1. Module graph

```
cli ─┬─► hub ──► core ──► spec
web ─┤    │  └─► fs ──► markdown
tui ─┘    ▲      ▲
       git ──────┘    git: fs over a clone + commit/push; exports gitSource
       jira ─► hub    jira: Effect HttpClient; exports jiraSource
```

| Module | May import |
| --- | --- |
| `hub` | spec, core, fs, `effect`, `yaml` |
| `git` | spec, fs, hub, `effect` |
| `jira` | spec, hub, `effect` |
| `cli` | adds hub, git, jira |
| `apps/web` | adds `@lemol/todo-md/hub`, `/git`, `/jira` |

- `hub`, `git` and `jira` import no Bun or Node API. They use Effect's
  `FileSystem`, `Path`, `ChildProcess` (`effect/unstable/process`) and
  `HttpClient` (`effect/unstable/http`) services, which composition roots
  provide.
- `core` and `TodoStore` are unchanged, apart from the capability change
  (section 5).
- `hub/testing` (`@lemol/todo-md/hub/testing`) exports `memorySource` for
  tests; runtime code never imports it.

## 2. Projects, the registry and `~/.todo-md`

### Home

`~/.todo-md`, overridden by `$TODO_MD_HOME`. The hub takes `home` (and
`userHome`, for `~` in paths) as parameters; apps resolve them.

```
~/.todo-md/
  projects.yaml            the registry
  .todo.lock               held while the registry is written (fs's makeLock)
  projects/<name>/         a project's data directory, owned by the hub
    state.json             sync status, written by the hub
    …                      the source's own files: clone/ (git), mirror.json (jira)
```

A source receives its data directory and touches nothing else. Removing a
project deletes the directory; renaming moves it.

### The registry

```yaml
projects:
  todo-md:
    source: fs
    path: ~/Labs/lemolsoft/lemol-workspace/repos/todo-md
  mionso:
    source: git
    url: git@github.com:lemol/mionso.git
    branch: main          # optional; default: the remote's HEAD
    list: todo            # optional: the list directory inside the repo
  work:
    source: jira
    site: https://acme.atlassian.net
    email: lemol@acme.com
    token_env: JIRA_TOKEN # or token_command: security find-generic-password -s jira -w
    jql: assignee = currentUser() AND statusCategory != Done
```

- **Names** match `[a-z0-9][a-z0-9-]*` and are unique because they are map
  keys. Map order is the dashboard order.
- **Default names:** the directory's basename for fs (its parent's if the
  path ends in `/todo`); the repository name for git; jira requires one.
- **Config** is `source` plus fields that the source validates with its own
  schema. `~` in paths expands to `userHome`, the OS home directory, which
  apps pass alongside `home`.
- **Broken entries degrade.** An entry with an unknown source (for example a
  build without jira) or invalid config is listed with an error status; the
  rest of the hub works.
- **Writes** use the `yaml` Document API so comments and key order survive,
  are atomic (temporary file, then rename) and run under
  `~/.todo-md/.todo.lock` (the fs lock, exported by task 14).
- **Secrets** never go in the file: `token_env` names an environment
  variable, `token_command` a command whose stdout is the token.

### Resolving the current project

Shared by every frontend:

1. `--project <name>`: a registry lookup; unknown names fail with
   `ProjectNotFound`.
2. `--dir <path>`: an **unregistered** fs project over that list.
3. Otherwise `findListRoot(cwd)`. If the list root belongs to a registered fs
   project (`fsSource.owns`), that project; otherwise an unregistered one.
   No list found fails with `NoListFound`, with today's message.

`--project` together with `--dir` is a usage error. An unregistered project
is named after its directory; if that name is taken by a registered project
it gets a numeric suffix (`todo-md-2`). It lives only for the hub's lifetime
and has no data directory.

## 3. The hub API

`Hub` is a `Context.Service`.
`Hub.layer({ home, userHome, sources, autoSync? })` requires `FileSystem`
and `Path`. Sources are values built at the composition root with their
own services already provided.

```ts
class Hub extends Context.Service<Hub, {
  // registry
  projects(): Effect<ReadonlyArray<ProjectInfo>, RegistryError>
  add(input: { name?: string; source: string; config: unknown }):
    Effect<ProjectInfo, RegistryError | InvalidProjectConfig | SourceUnavailable | SourceError>
  remove(name: string, options?: { force?: boolean }): Effect<void, ProjectNotFound | RegistryError | SourceError>
  rename(from: string, to: string): Effect<ProjectInfo, ProjectNotFound | RegistryError>
  resolve(at: { project?: string; dir?: string; cwd: string }): Effect<ProjectInfo, ProjectNotFound | NoListFound>

  // one project
  todo(project: string): Effect<TodoService["Service"], ProjectNotFound | SourceUnavailable | SourceError>
  status(project: string): Effect<ProjectStatus, ProjectNotFound>
  sync(project: string): Effect<SyncResult, ProjectNotFound | SyncError>
  syncAll(): Effect<ReadonlyArray<SyncResult | SyncFailure>>

  // across projects
  overview(query: OverviewQuery): Effect<Overview, RegistryError>
  readonly changes: Stream<HubChange>
}>()("@lemol/todo-md/hub/Hub") {}
```

```ts
interface ProjectInfo {
  readonly name: string
  readonly source: string          // the kind
  readonly location: string        // path, URL or site, for display
  readonly registered: boolean
  readonly syncable: boolean       // the source has `sync`
  readonly status: ProjectStatus
}

interface ProjectStatus {
  readonly lastSync?: DateTime.Utc
  readonly result: "ok" | "error" | "never"
  readonly error?: string          // the last sync or config error
  readonly ahead?: number          // git: local commits not pushed
  readonly behind?: number         // git: remote commits not pulled (as of the last fetch)
  readonly diverged?: boolean      // git: the last rebase conflicted
}

type HubChange =
  | { readonly kind: "changed" | "synced"; readonly project: string }
  | { readonly kind: "registry" }

interface OverviewQuery {
  readonly projects?: ReadonlyArray<string>   // default: every registered project
  readonly sources?: ReadonlyArray<string>
  readonly filter?: TaskFilter                // from core
}

interface Overview {
  readonly projects: ReadonlyArray<
    | { readonly project: ProjectInfo; readonly listing: Listing }
    | { readonly project: ProjectInfo; readonly error: SourceError | StoreError }
  >
  readonly tasks: ReadonlyArray<{ readonly project: string; readonly ref: string; readonly view: TaskView }>
}
```

- **The hub is the outer interface; `core` flows through it.**
  `hub.todo(name)` returns `core`'s `TodoService` over the project's store,
  so frontends keep using `list`, `next`, `show`, `complete` and the rest,
  and `core`'s views. They never build stores.
- **Per-project layers** are built lazily and cached with Effect's
  `LayerMap`, keyed by project name, and invalidated when the project's
  registry entry changes.
- **`overview`** runs `list(filter)` on each chosen project with bounded
  concurrency (4). A failing project yields an `error` entry; it never fails
  the whole overview. `tasks` is flattened in project order, then priority
  order.
- **Qualified references** are `<project>:<id>` (`todo-md:12`,
  `work:PROJ-7`). Neither project names nor Jira keys contain `:`.
  `parseRef` and `formatRef` are exported.
- **Status** persists in `projects/<name>/state.json`. Sources contribute
  live fields (`ahead`, `behind`) through `status`.
- **Sync** is explicit. `sync` on a source without `sync` succeeds and
  changes nothing. Syncs of one project are serialized within a process;
  across processes, sources rely on their own locks. `syncAll` runs with
  bounded concurrency (4) and never stops at the first failure.
- **`autoSync`** (a `Duration`, off by default) runs `syncAll` periodically
  in a scoped fiber, for long-running hosts. The CLI never sets it. Reads
  never trigger a sync.
- **`changes`** is lazy: watchers run only while something consumes the
  stream, so the CLI never starts one. It merges:
  - each source's `changes` stream for every registered project, plus
    unregistered projects opened in this hub (every source watches its
    local replica, so another process's writes show up);
  - `changed` after the hub's own mutations, only for projects whose source
    has no `changes`;
  - `synced` after each sync;
  - `registry` when `projects.yaml` changes (watched), so a web app sees a
    project added from the CLI.

### Errors

| Error | Carries | When |
| --- | --- | --- |
| `ProjectNotFound` | `name` | No registered or open unregistered project has this name. |
| `NoListFound` | `cwd` | Resolution found no list. |
| `InvalidProjectConfig` | `name`, `issues` | The source's schema rejected the entry. |
| `SourceUnavailable` | `name`, `source` | No loaded source has this kind. |
| `SourceError` | `name`, `message`, `cause` | Opening or preparing a project failed (for example a git clone). |
| `RegistryError` | `message`, `cause` | Reading or writing `projects.yaml`. |
| `SyncError` | `name`, `reason`, `message` | `reason`: `offline`, `auth`, `rejected`, `diverged` or `remote`. |

`SyncFailure` is `{ project, error: SyncError }`, used by `syncAll`.

The built error unions are wider; see `src/hub/README.md`.

## 4. Sources

### The interface

```ts
interface Source<C> {
  readonly kind: string
  readonly config: Schema.Codec<C>
  defaultName?(config: C): string | undefined
  location(config: C): string
  prepare?(p: SourceProject<C>): Effect<void, SourceError>        // on add: git clones, jira syncs
  open(p: SourceProject<C>): Layer<TodoStore, SourceError>
  sync?(p: SourceProject<C>): Effect<SyncOutcome, SyncError>
  changes?(p: SourceProject<C>): Stream<void>
  status?(p: SourceProject<C>): Effect<Partial<ProjectStatus>>
  beforeRemove?(p: SourceProject<C>, force: boolean): Effect<void, SourceError>
  owns?(config: C, listRoot: string): boolean
}

interface SourceProject<C> {
  readonly name: string
  readonly config: C
  readonly dir: string            // the project's data directory
}

interface SyncOutcome {
  readonly summary: string        // e.g. "pulled 3 commits, pushed 1"
  readonly ahead?: number
  readonly behind?: number
}
```

### fs

- Config `{ path }`. `open` is `FsTodoStore.layer` over the list at `path`:
  `todo/TODO.md` first, then `TODO.md`, without walking up.
- `changes`: `FileSystem.watch(root, { recursive: true })`, debounced
  100 ms, ignoring `.todo.lock` and `*.tmp`. This replaces
  `apps/web/watch.ts`.
- `owns`: the resolved list root equals the discovered one.
- No `sync`, no `prepare`.

### git (`src/git`, `@lemol/todo-md/git`)

- Config `{ url, branch?, list? }`. Shells out to `git` through
  `ChildProcess`, so credentials come from the user's setup (ssh agent,
  credential helpers). No tokens are stored.
- **`prepare`** clones into `<dir>/clone` with `--filter=blob:none` (and
  `--branch` when given). **`sync`** clones when the clone is missing;
  **`open`** on a missing clone fails with a `SourceError` asking for
  `todo sync <name>`.
- **The list** is `<clone>/<list>` when `list` is set, otherwise the
  discovery order at the clone root.
- **The store** is `FsTodoStore` over the list, wrapped so each successful
  mutation, under a clone lock (`<dir>/.todo.lock`):
  1. runs the fs operation;
  2. stages the list directory (`git add -A -- <list>`);
  3. commits `todo: <operation> <id> - <title>` with the user's git
     identity, skipping the commit if nothing changed.

  Then, outside the lock, it pushes to the tracked branch:
  - rejected: `git pull --rebase`, push once more;
  - still failing or unreachable: the commit stays local; status shows
    `ahead`;
  - a rebase conflict: `git rebase --abort`; `diverged` is recorded, with
    the clone path in the error.

  The source records the last push error and `diverged` in its own
  `<dir>/git.json` (the hub owns `state.json`) and reports them through
  `status`.

  **A mutation never fails because of the network.** Its outcome shows up in
  `status`. Commit failures (for example no git identity) are `StoreError`s.
- **`sync`:** fetch; `pull --rebase`; push if ahead. A conflict aborts the
  rebase and fails with `SyncError` `diverged`. Success clears `diverged`.
- **`status`:** `ahead` and `behind` from
  `git rev-list --left-right --count HEAD...@{u}`.
- **`changes`:** a watch on the clone's list directory, so mutations from
  another process show up.
- **`beforeRemove`:** refuses while `ahead > 0` unless forced.
- Normalization (spec §2.11) still runs before every mutation, and its
  changes are part of that mutation's commit.

### jira (`src/jira`, `@lemol/todo-md/jira`)

- Config `{ site, email, token_env | token_command, jql?, done_jql?,
  done_transition?, reopen_transition? }`. REST API v3 over `HttpClient`,
  basic auth with email and API token.
- **Defaults:** `jql` = `assignee = currentUser() AND statusCategory !=
  Done`; `done_jql` = `assignee = currentUser() AND statusCategory = Done
  AND resolved >= -30d`. `ORDER BY Rank ASC` is appended when the query has
  no `ORDER BY`.
- **Capabilities:** `comments` only. `add`, `remove`, `groups`, `reorder`
  and `renameGroup` are absent.
- **`sync`** fetches both queries (paginated) and writes `<dir>/mirror.json`
  atomically: `{ version: 1, syncedAt, open: Task[], done: Task[] }` in the
  model's encoded form. **`prepare`** runs the first sync, which also checks
  the credentials.
- **Reads** come from the mirror. `get` of a key not in the mirror fetches it
  live. A missing mirror is a `StoreError` asking for `todo sync <name>`.
- **Mapping:**

  | Model | Jira |
  | --- | --- |
  | `id` | issue key |
  | `title` | summary |
  | `description` | description, ADF → Markdown (read-only) |
  | `tags` | labels |
  | `assignee` | slug of the assignee's display name |
  | `dependsOn` | inward "is blocked by" links |
  | `comments` | comments, newest first; author = slug of the display name; ADF → Markdown |
  | `completedAt` | resolution date |
  | `extra` | `status`, `priority`, `url`, `project`, `assignee_name`, `assignee_account` |

- **Mutations** call the API, then re-fetch that issue into the mirror:
  - `complete`: the first transition into the "done" status category, or
    `done_transition` by name; `InvalidTransition` when already done;
  - `reopen`: the first transition into the "new" ("To Do") category, or
    `reopen_transition`; `InvalidTransition` when not done;
  - `comment`: the body sent as ADF paragraphs (plain text; Markdown is not
    converted). The comment's author is the API user;
  - `update`: `title` and `tags`. A patch of `description`, `assignee`,
    `dependsOn` or `extra` fails with `ValidationError` (read-only here).
- **Errors:** 401/403 → `auth`, network failures → `offline`, 429 →
  `remote` with the retry-after time, other statuses → `remote`.
- **`changes`:** a watch on `mirror.json`.

## 5. Spec change: `add` and `remove` capabilities

- Spec §1.5 gains `add` (absent: `add` fails with `Unsupported`) and
  `remove` (absent: `remove` fails with `Unsupported`). The always-required
  operations become `load`, `get`, `listDone`, `update`, `complete` and
  `reopen`.
- `Capabilities` gains `add` and `remove`; `allCapabilities` sets them.
- `core`'s guard checks them before calling the store.
- The conformance suite already skips cases by `requires`. Cases that test
  `add` or `remove` require those capabilities. `runConformance(name, layer,
  options?)` accepts `options.seed(tasks)`, an Effect that puts tasks into a
  fresh store, which cases use for setup when the store lacks `add`.
- The CLI's `add` and `rm` report `Unsupported` as today; the web app hides
  the add form without `add`.

## 6. Frontends

### CLI

- `bin.ts` builds `Hub.layer({ home, sources: [fsSource, gitSource,
  jiraSource] })` with `home` from `$TODO_MD_HOME` or `~/.todo-md`.
  `withTodo` becomes `hub.resolve` then `hub.todo`.
- **`--project <name>`** global flag; exclusive with `--dir` (exit 2).
- **Qualified references** wherever a task ID is taken (`todo done
  mionso:12`). A reference whose project contradicts `--project`, or
  anchors and dependencies in another project, are usage errors.
- **New commands:**
  - `todo projects` (`ls`): name, source, location, open and ready counts,
    sync status;
  - `todo projects add <path|url> [--name] [--source] [--branch] [--list]
    [--site] [--email] [--token-env] [--token-command] [--jql]`. The source
    is inferred: a path is fs; `git@…`, `https://…​.git`, `ssh://…` and
    `github.com/…` URLs are git; jira needs `--source jira`;
  - `todo projects rm <name> [--force]`;
  - `todo projects rename <from> <to>`;
  - `todo sync [<name>…] [--all]`: default the current project; one line
    per project; exit 1 if any failed.
- **`todo ls --all`** and **`todo next --all`**: `overview` across
  registered projects, grouped under project headings, with qualified IDs.
- **After a mutation** on a syncable project, the CLI reads `hub.status` and
  warns on stderr when the change is not pushed (`not pushed: offline (ahead
  1)`) or the project diverged. The exit code stays 0.
- `--json` results gain a `project` field. `init` and `fmt` work on fs lists
  only; with another source they are usage errors.

### Web

- `server.ts` builds the hub in a `ManagedRuntime`. `watch.ts` and
  `ListChanges` are deleted; `/events` streams `hub.changes` as SSE, each
  event naming its project, and the browser entry ignores other projects'
  events.
- Startup resolution matches the CLI's; the resolved project's board is the
  URL printed at startup. The server serves every registered project.
- **Routes:**

  | Route | Page |
  | --- | --- |
  | `GET /` | **Dashboard**: a section per project with name, source badge, sync status, open/ready/blocked counts and the next ready tasks. Filters are query parameters mapped to `OverviewQuery`: `project` (repeatable), `source`, `tag`, `assignee`, `state`. `view=flat` lists every matching task with qualified IDs. **Sync all**. |
  | `/p/:project`, `/p/:project/tasks/…`, `/p/:project/done`, `/p/:project/check` | Today's pages under a project prefix. Each project's capabilities drive the UI. |
  | `GET /projects`, `POST /projects`, `POST /projects/:name/rename`, `POST /projects/:name/remove` | Manage projects. An unregistered startup project shows **Register**. |
  | `POST /p/:project/sync`, `POST /sync` | Sync, then redirect with a flash naming the result. |

- A project switcher in the header. Security is unchanged (localhost, Host
  allowlist, `cop`), which is what makes project management from the
  browser acceptable. Adding a git project clones synchronously, then
  redirects.

### TUI

Later. With the hub it is presentation only: dashboard, board and task
views over `overview`, `todo()` and `changes`.

## 7. Testing

- **hub:** `memorySource` and temporary homes. Registry round-trips keep
  comments; resolve precedence and the unregistered-name suffix; `LayerMap`
  reuse and invalidation; `overview` isolates a failing project; sync state
  persistence; `changes` from a source, from registry edits, and after own
  mutations. The debounce test moves from `apps/web/test/watch.test.ts`.
- **git:** `runConformance` over a clone of a local bare repository
  (`file://`). Scenarios: another clone pushes first (rejected → rebase →
  pushed); a conflicting edit (diverged, rebase aborted, mutation kept); an
  unreachable remote (ahead 1, mutation succeeded); remove refuses while
  ahead.
- **jira:** a fake Jira behind an `HttpClient` test layer. `runConformance`
  with `seed`; golden ADF → Markdown tests; transition choice; error
  mapping for 401, 429 and network failures.
- **cli:** end to end with a temporary `$TODO_MD_HOME`; help test covers the
  new commands.
- **web:** router tests with the hub over `memorySource`.
- **boundaries:** rules and checker cases for `hub`, `git`, `jira` and the
  web app's new imports.
- No test reaches the network or the real `~/.todo-md`.

## 8. Docs

- `docs/architecture.md` becomes `docs/architecture/`, split by topic, with
  the hub and sources described as planned until built.
- `docs/spec.md` changes only in task 13 (capabilities), together with the
  code.
- Each new module gets a `README.md` like the existing ones.

## 9. Tasks

In `todo/TODO.md`, group **Hub and sources**, in priority order:

| ID | Task | Depends on |
| --- | --- | --- |
| 13 | Make add and remove store capabilities | – |
| 14 | Build the hub: registry, resolution and project services | – |
| 15 | Add sync, status, changes and overview to the hub | 14 |
| 16 | Run the CLI on the hub with projects and sync commands | 15 |
| 17 | Run the web app on the hub | 15 |
| 18 | Add the web dashboard and project management | 17 |
| 19 | Add the git source | 15 |
| 06 | Add the Jira source | 13, 15 |

Under **Later**: 20, *Build a TUI over the hub* (depends on 15), and 09,
moved there and rewritten to build on the hub and the git source; it is
about hosting and authentication only (depends on 17, 19).

Tasks 19 and 06 each wire their source into the CLI's and the web app's
composition roots and add their `todo projects add` flags; tasks 16 and 17
wire only `fsSource`.

Each task file holds the goal, scope, design details, files to touch, tests,
docs and acceptance criteria. `bun run check` passing is always one of them.

## Deferred

- SQLite, until cross-project search needs it.
- Scanning root directories for lists.
- Cross-project dependencies.
- Markdown → ADF, creating and deleting Jira issues.
- A progress UI for long clones in the web app.
