# todo.md web app

Run `bun run web -- --dir <list>` from the repository root. Defaults are
`127.0.0.1:4400`; `--port` selects the starting port and an occupied port is
followed by the next available port. `--host` can widen binding; widening it
prints a warning because anyone who can reach the address can edit the list.

The app exposes Board (`/`), task detail/edit and mutations under `/tasks`,
group rename under `/groups`, Done (`/done`), diagnostics (`/check`), live
changes (`/events`) and source assets (`/assets/*path`). HTML forms use
POST/303 and work without JavaScript.

- **Move.** Board rows have ↑/↓ buttons that move a task before the row above
  or after the row below (in the view as shown, filters included). The task
  page's Move form sends it to the top or bottom of a group, or a new one.
  Both need `reorder`; the group select also needs `groups`.
- **Remove.** The task page links to a confirm page (`GET /tasks/:id/remove`)
  that lists open dependents; with any, the button becomes "Remove anyway"
  and sends `force`.
- **Rename group.** Each group heading links to `/groups/rename?name=…`,
  shown only with `renameGroup`.
The browser entry listens for file changes and replaces the live region only
when no form has unsaved input; dirty forms show a reload notice instead.

`server.ts` is the composition root. `watch.ts` supplies debounced file
changes; `app/middleware` supplies request capabilities; `app/actions` owns
routes; `app/ui` owns shared rendering and styles. Hosting/authentication,
GitHub-backed storage and a published `todo web` command are deferred.
