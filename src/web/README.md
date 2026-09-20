# todo.md web app

Run `todo web --dir <list>` or `todo web --project <name>` (or `bun src/cli/bin.ts web
--dir <list>` from source). Defaults are `127.0.0.1:4400`; `--port` selects the
starting port and an occupied port is followed by the next available port.
`--host` can widen binding; widening it prints a warning because anyone who can
reach the address can edit the list. `--project` and `--dir` are exclusive.

The server serves every project registered in the hub's home (`$TODO_MD_HOME`,
else `~/.todo-md`), plus the startup project when it is not registered yet.
`GET /` is the cross-project dashboard; each project's board is at
`/p/<name>`.

| Route | Page |
| --- | --- |
| `GET /` | Dashboard: a section per project with counts and next ready tasks, a filter bar, **Sync all**. `view=flat` lists every matching task with qualified IDs. |
| `GET /go?project=` | The header switcher's redirect; works without JavaScript. |
| `POST /sync` | `hub.syncAll`, then 303 back with a flash summary. |
| `GET /projects` | Every project: name, source, location, status; **Sync**, **Rename**, **Remove**; an add form. |
| `POST /projects` | Adds a project; 303 to its board, or 422 with the form and the reason. |
| `POST /projects/:name/rename`, `POST /projects/:name/remove` | Rename and remove; a refused removal answers 422 with **Remove anyway**. |
| `GET /p/:project`, `/p/:project/done`, `/p/:project/check`, `/p/:project/tasks/…` | One project's pages. |
| `POST /p/:project/sync` | Syncs one project, 303 back with a flash. |
| `GET /events` | `hub.changes` as SSE: `changed`, `synced`, `registry`. |

Each project's pages live under `/p/:project`. Live changes (`/events`) and
source assets (`/assets/*path`) are shared. A page's `<main>` declares either
`data-project` (that project's `changed`/`synced`) or `data-live-events` (hub
event kinds); `shouldRefresh` in `app/actions/public/refresh.ts` is the rule, and
a dirty form downgrades a refresh to a notice. HTML forms use POST/303 and work
without JavaScript.

- **Move.** Board rows have ↑/↓ buttons that move a task before the row above
  or after the row below (in the view as shown, filters included). The task
  page's Move form sends it to the top or bottom of a group, or a new one.
  Both need `reorder`; the group select also needs `groups`.
- **Add.** The board's Add task form needs `add`; without it the board is
  read-and-complete only.
- **Remove.** The task page links to a confirm page (`GET /p/:project/tasks/:id/remove`)
  that lists open dependents; with any, the button becomes "Remove anyway"
  and sends `force`. Both need `remove`, and the confirm page answers
  `Unsupported` without it rather than asking a question it cannot honour.
- **Rename group.** Each group heading links to `/p/:project/groups/rename?name=…`,
  shown only with `renameGroup`.

Every project's capabilities come from its own `TodoService.capabilities`
(derived from its store), not a global setting — a project without `groups`
or `comments` simply hides that UI.

`server.ts` is the composition root: it builds a `Hub.layer` runtime over
`fsSource` and the [git source](../git), and resolves the startup project the
same way the CLI does. The Projects page's add form carries git's optional
branch and list fields; they are refused for a target that is not git. `app/middleware`
supplies request capabilities, including `loadProject` for `/p/:project` and
`provideHub` for hub-level routes; `app/actions` owns routes; `app/ui` owns
shared rendering and styles. Hosting/authentication and GitHub-backed storage
are deferred (task 09).

## Adopting @lemol/ui

The web app is adopting `@lemol/ui` (M3). Key architectural patterns established in the render spike:

- **Node-returning components:** Pages and UI elements return Remix JSX nodes rather than HTML strings. The shell is composed using `@lemol/ui/mini/document` (`Document`) and `@lemol/ui/mini` (`AppShell`, `Nav`), with page content composed from `@lemol/ui/remix` components (`Heading`, `Stack`, `Text`, `Badge`, etc.).
- **Live region accommodation:** `<main id="main">` in `AppShell` does not carry arbitrary data attributes. Instead, the page content inside `<main>` is wrapped in `<div data-live-region data-project={project} ...>`, which `entry.ts` locates via `querySelector("[data-live-region]")` and replaces upon live events with no upstream shell changes required.
- **Nav badges:** Upstream `NavItem` in `@lemol/ui/mini` takes a string `label`. Badges on nav items (e.g. diagnostics count on Check) are represented in text (e.g. `Check (2)`) pending an upstream accommodation in `repos/ui` to allow `badge?: RemixNode` on `NavItem`.
- **Dialog open on 422:** `DialogPanel` does not have an `open` prop, and native `<dialog open>` without JS is not in modal state. Forms with validation errors on 422 render inline / full-page with error feedback (matching the no-JS and deep-link flow), rather than attempting to force a reopened modal.
- **Markdown embedding:** `@lemol/ui` has no markdown component. Markdown is parsed and sanitized via `markdownHtml` and embedded into the JSX tree using a wrapper element with `innerHTML={markdownHtml(text)}`.

