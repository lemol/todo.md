# Web app design

Task 05: build the web app on `core`. This first version is a local server
over one list directory. A hosted, GitHub-backed version is a later task; the
design keeps the adapter choice at the composition root so it can slot in.

## Scope

In:

- Board of open tasks, task detail, done tasks, diagnostics.
- Edits: add, complete, reopen, edit fields, comment.
- Live refresh when the list's files change (CLI, agents, hand edits).

Out, for later tasks:

- Move/reorder, remove and rename group.
- A `todo web` command in the published package.
- Hosting, auth, and a GitHub-backed adapter.

## Shape and packaging

- **Location.** `apps/web/` is a private workspace member,
  `@lemol/todo-md-web`. The root `package.json` gains
  `"workspaces": ["apps/*"]`; git-dependency consumers of `@lemol/todo-md`
  ignore it, so the published package is unchanged and does not depend on
  Remix.
- **Dependencies.** `@lemol/todo-md: workspace:*`, `remix: 3.0.0-rc.2`
  (exact, matching mionso's `money-web`; upgraded together like `effect`),
  `@effect/platform-bun`, `mdast-util-from-markdown`, `mdast-util-to-hast`,
  `hast-util-to-html`, and `effect` as a peer dependency.
- **Imports.** The app is a consumer: it imports `@lemol/todo-md/spec`,
  `/core` and `/fs` by package name, never `markdown` or `spec/testing`
  (tests may use `spec/testing`). `test/boundaries.test.ts` gains an
  `apps/web` rule enforcing this.
- **Remix version.** The Remix skill describes Remix's main branch. Where it
  and `3.0.0-rc.2` disagree, the installed package's
  `node_modules/remix/src/<subpath>/README.md` wins.

### Layout

Following Remix conventions:

```
apps/web/
  package.json, tsconfig.json   jsxImportSource "remix/ui", DOM libs
  server.ts                     composition root
  watch.ts                      fs implementation of ListChanges
  app/
    routes.ts                   the URL contract; every href comes from it
    router.ts                   createAppRouter, middleware stack, AppContext
    middleware/
      todo.ts                   runtime + capabilities on the context, runTodo
      changes.ts                the ListChanges interface and context key
      local.ts                  Host allowlist
    actions/
      controller.tsx            board, done, check, events
      tasks/controller.tsx      task routes
      respond.ts                shared error → Response mapping
      public/entry.ts           the only browser entry: live refresh
    ui/                         shared layout, task row, badges, Markdown
  test/
```

### Composition root

`server.ts`:

1. Parses `--dir`, `--port` (default 4400; tries the next port when busy)
   and `--host` (default `127.0.0.1`).
2. Resolves the list root: `--dir`, otherwise `findListRoot(cwd)`. With no
   list found, it prints the same message as the CLI and exits 1.
3. Builds a `ManagedRuntime` from `TodoService.layer`,
   `FsTodoStore.layer({ root })` and `BunServices.layer`.
4. Calls `createAppRouter({ runtime, capabilities, changes, author, hosts })`
   and serves it with `Bun.serve`.
5. Disposes the runtime and the watcher on SIGINT/SIGTERM.

The router never sees `FsTodoStore`. A GitHub-backed server changes only
`server.ts`: a different store layer and a `ListChanges` that polls.

`author` is the default comment author: `$TODO_MD_AUTHOR`, then the OS user
name, as in the CLI.

`bun run web -- --dir <list>` at the repository root starts it.

### The gate

`bun run check` covers the app: Biome already lints the whole repository,
`typecheck` adds `tsc -p apps/web`, and `bun test` finds the app's tests.

## Pages and routes

The board mirrors `TODO.md`, like the CLI's list. Every mutation is an HTML
form that POSTs and redirects, so the app works without JavaScript.

| Route | Page or effect | core call |
| --- | --- | --- |
| `GET /` | **Board.** List title and description; each section, ungrouped first, with its open tasks in priority order. A row shows ID, title, `#tags`, `@assignee`, a ready/blocked badge and "blocked by" links. The next ready task is highlighted. Tag and assignee chips link to filtered views; query parameters `tag` (repeatable), `assignee`, `group` and `state` map to `TaskFilter`. A summary line and an **Add task** form (title; group select with "new group…") sit at the top. | `list(filter)`, `next()` |
| `POST /tasks` | Add, then redirect to the new task. | `add` |
| `GET /tasks/:id` | **Task.** Title, state, group, tags, assignee, description; dependencies with title and state (`unknown` for missing IDs); the tasks it blocks; comments, newest first. **Complete** or **Reopen**, **Edit**, and a comment form. | `show(id)` |
| `GET /tasks/:id/edit` | Edit form: title, description, tags, assignee, depends-on. | `show(id)` |
| `POST /tasks/:id` | Update, then redirect to the task. A blank assignee clears it. | `update` |
| `POST /tasks/:id/complete` | Complete, from the board's checkbox or the task page. Redirect back to where the form was (a `back` field holding a local path; the board otherwise), flash "Completed 05. Now ready: 07, 08". | `complete` |
| `POST /tasks/:id/reopen` | Reopen, redirect to the task. | `reopen` |
| `POST /tasks/:id/comments` | Comment; the author field is prefilled with the default author. | `comment` |
| `GET /done` | Done tasks, most recent first, with completion date, recorded group and **Reopen**. | `list({ status: "done" })` |
| `GET /check` | Diagnostics grouped by severity, linked to their tasks. | `check()` |
| `GET /events` | Server-sent events: `changed` when the list changes. | `ListChanges` |

- **IDs** in URLs are accepted as shown (`07`) or bare (`7`), like the CLI.
- **Tags and depends-on** are entered as space- or comma-separated text.
- **Header.** Every page shows the list title, links to Board, Done and
  Check, and the count of error and warning diagnostics.
- **Capabilities drive the UI** (spec §1.5): the group select appears only
  with `groups`, the comment form only with `comments`.
- **Markdown.** Descriptions and comments are rendered with
  `mdast-util-from-markdown` → `mdast-util-to-hast` → `hast-util-to-html`.
  Raw HTML is dropped, not passed through.
- **Flash messages** use a Remix session with memory storage and a random
  secret generated at startup. Sessions carry nothing else.

### Errors

| Failure | Response |
| --- | --- |
| `TaskNotFound` | 404 page. |
| `ValidationError` on add or edit | 422: the form again, with the issues and the submitted values. |
| `InvalidTransition` (a stale tab) | Redirect back with a flash explaining it. |
| `GroupNotFound`, `Unsupported` | 400 page with the message. The UI hides unsupported actions, so these mean a hand-crafted request. |
| `StoreError`, defects | 500 page with the message. |
| Invalid form input | 400, or 422 with the form where there is one. |

## Visual design

Minimal and document-like: the page reads like a well-typeset `TODO.md`.

- **Principles.** One column, about 760px at most, generous whitespace.
  Hairlines instead of cards. Color only where it carries meaning. No
  gradients, heavy shadows, emoji or icon library. Everything is served by
  the app itself, so it works offline.
- **Type.**
  - Sans for UI and body: `"SF Pro Text", "Helvetica Neue", system-ui,
    sans-serif`, color `#2F3437`, line-height 1.6.
  - Serif for the list title and section headings: `"Iowan Old Style",
    Charter, Georgia, serif`, letter-spacing -0.02em, line-height 1.1.
  - Mono for IDs, assignees, dates and diagnostic codes: `"SF Mono",
    ui-monospace, monospace`.
- **Palette** as CSS custom properties: canvas `#FBFBFA`, surface `#FFFFFF`,
  hairline `#EAEAEA`, muted text `#787774`, primary `#111111`. A
  `prefers-color-scheme: dark` block redefines the same tokens.
- **Semantic pastels**, background with text color:

  | Meaning | Background | Text |
  | --- | --- | --- |
  | ready | `#EDF3EC` | `#346538` |
  | blocked, warning | `#FBF3DB` | `#956400` |
  | error | `#FDEBEC` | `#9F2F2D` |
  | info | `#E1F3FE` | `#1F6C9F` |

  Tags are neutral chips (`#F7F6F3`). Badges always carry text, so state
  never depends on color alone.
- **Board.** The list title in large serif, its description in muted sans.
  Section names in smaller serif over a hairline. Task rows are separated
  by hairlines, not boxed:
  - a square outlined checkbox button that completes the task (a form POST,
    mirroring `- [ ]`);
  - the ID in muted mono, then the title as a link;
  - on the right, tag chips, `@assignee` and a small uppercase `READY` or
    `BLOCKED` badge;
  - for blocked tasks, a muted "blocked by 03, 07" line underneath.

  The next task has a 2px charcoal bar on its left edge.
- **Controls.** Primary buttons: solid `#111111`, white text, 6px radius,
  `scale(0.98)` when pressed. Secondary actions are text buttons. Inputs:
  1px hairline, 6px radius, charcoal focus ring. Focus is always visible.
- **Task page.** A document column: title in serif, a metadata strip of
  hairline-separated label and value pairs (values in mono), rendered
  Markdown, and comments with author and time in mono above each body.
- **Header.** The list title in small sans, then Board, Done and Check.
  Check carries a red or yellow count badge when there are diagnostics.
- **Flash messages.** One quiet full-width bar in the matching pastel.
- **Empty states.** A plain muted sentence, such as "Nothing open. Add a
  task above."
- **Motion.** Only 150–200 ms transitions of color, border and opacity on
  hover and focus, disabled under `prefers-reduced-motion`. No entrance
  animations: live refresh would replay them.
- **Styles.** Tokens and base styles live in `app/ui/styles.css`, served by
  the app. Component-local styles use Remix's `css()` mixin where it renders
  on the server in rc.2; the implementation plan checks that first.

## Effect bridge

- `loadTodo({ runtime, capabilities })` middleware puts both on the typed
  `AppContext`.
- `runTodo(context, (todo) => todo.show(id))` runs an effect that needs
  `TodoService` through the runtime and returns `{ ok: true, value }` or
  `{ ok: false, error }`, where `error` is the effect's typed failure.
  Defects are rethrown and become 500s.
- `respond.ts` maps the common failures to responses. Only add and edit
  handle `ValidationError` themselves.
- No cache: every request goes through `core`, which re-reads the list.

## Live changes

- `ListChanges` is `{ subscribe(listener: () => void): () => void }`.
- `watch.ts` implements it with one recursive `fs.watch` on the list root,
  debounced 100 ms, ignoring `.todo.lock` and `*.tmp` (the fs adapter's
  temporary files).
- `GET /events` subscribes once per connection and unsubscribes when the
  request aborts. It sends `event: changed` and a heartbeat comment every
  15 s.
- `entry.ts` subscribes with `EventSource`. On `changed` it re-fetches the
  current page and replaces the main region, unless a form on the page has
  unsaved input; then it shows a "The list changed. Reload" notice instead.
  The implementation plan checks rc.2's `<Frame>` API first and uses it if
  it can reload the main region on demand; otherwise `entry.ts` does a plain
  fetch-and-replace.
- The app's own writes fire events too. The submitting tab reloads through
  its redirect; other tabs refresh.

## Security

The server has no auth; it is safe because only this machine can reach it.

- **Binding.** `127.0.0.1` by default. `--host` can widen it, with a startup
  warning that anyone who can reach the port can edit the list.
- **Host allowlist.** Requests whose `Host` is not `localhost`, `127.0.0.1`,
  `[::1]` or the `--host` value (with the port) get 403. This blocks DNS
  rebinding, including on `/events`.
- **Cross-origin.** `remix/middleware/cop` rejects cross-origin unsafe
  requests, so other websites cannot post forms to the server.
- **Escaping.** JSX escapes text; Markdown rendering drops raw HTML.

## Testing

`bun:test`, like the rest of the repository.

- **Router tests** per controller build a fresh router over
  `MemoryTodoStore` and drive it with `router.fetch(new Request(...))`,
  using `routes.*.href()` for URLs. They cover each route's status and
  content, POST → redirect, 422 on a cycle, 404, the flash after complete,
  and hidden group and comment UI with a store lacking those capabilities.
- **End to end over `FsTodoStore`:** on a temporary list, add and complete
  through the router, then assert `TODO.md` and `done/` on disk.
- **Events:** a fake `ListChanges` emits and the stream yields
  `event: changed`; aborting the request unsubscribes.
- **Watcher:** writing a task file in a temporary list fires one debounced
  event; touching `.todo.lock` or a `*.tmp` file fires none.
- **Security:** a foreign `Host` gets 403; a cross-origin POST is rejected.
- **Browser entry:** the "replace or show notice" decision is a pure
  function with unit tests. No DOM tests in this version.
- **Boundaries:** the `apps/web` rule has a test case of its own.

## Docs and backlog

- `apps/web/README.md`: running it, routes, structure, limits.
- `docs/architecture.md`: the `apps/web` row and import rule, the diagram's
  "web (later)" replaced, and decision-log entries for "Remix 3, local server
  first" and "GitHub-backed hosting later".
- `README.md` and `AGENTS.md`: short mentions of `apps/web` and
  `bun run web`.
- `todo/TODO.md`: complete 05, and add follow-ups: hosted GitHub-backed web
  app; move/reorder, remove and rename group in the web app; a `todo web`
  command; registering `repos/todo-md/apps/*` in lemol-workspace.
