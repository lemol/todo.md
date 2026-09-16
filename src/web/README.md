# todo.md web app

Run `todo web --dir <list>` or `todo web --project <name>` (or `bun src/cli/bin.ts web
--dir <list>` from source) to serve a project's board at `/p/<name>`. Defaults
are `127.0.0.1:4400`; `--port` selects the starting port and an occupied port
is followed by the next available port. `--host` can widen binding; widening
it prints a warning because anyone who can reach the address can edit the
list. `--project` and `--dir` are exclusive.

The server serves every project registered in the hub's home
(`$TODO_MD_HOME`, else `~/.todo-md`), plus the one project resolved at
startup if it isn't registered. `GET /` redirects to the startup project's
board; task 18 replaces it with a cross-project dashboard.

Each project's pages live under `/p/:project`: Board (`/p/:project`), task
detail/edit and mutations under `/p/:project/tasks`, group rename under
`/p/:project/groups`, Done (`/p/:project/done`) and diagnostics
(`/p/:project/check`). Live changes (`/events`) and source assets
(`/assets/*path`) are shared across every project; each SSE event names the
project it belongs to, and the browser only re-renders when that matches the
page it's showing. HTML forms use POST/303 and work without JavaScript.

- **Move.** Board rows have ↑/↓ buttons that move a task before the row above
  or after the row below (in the view as shown, filters included). The task
  page's Move form sends it to the top or bottom of a group, or a new one.
  Both need `reorder`; the group select also needs `groups`.
- **Remove.** The task page links to a confirm page (`GET /p/:project/tasks/:id/remove`)
  that lists open dependents; with any, the button becomes "Remove anyway"
  and sends `force`.
- **Rename group.** Each group heading links to `/p/:project/groups/rename?name=…`,
  shown only with `renameGroup`.

Every project's capabilities come from its own `TodoService.capabilities`
(derived from its store), not a global setting — a project without `groups`
or `comments` simply hides that UI.

`server.ts` is the composition root: it builds a `Hub.layer` runtime and
resolves the startup project the same way the CLI does. `app/middleware`
supplies request capabilities, including the new `loadProject` middleware
that resolves `/p/:project` through the hub; `app/actions` owns routes;
`app/ui` owns shared rendering and styles. Hosting/authentication and
GitHub-backed storage are deferred (task 09); the project dashboard and
project management UI are deferred (task 18).
