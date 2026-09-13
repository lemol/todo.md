# todo.md web app

Run `bun run web -- --dir <list>` from the repository root. Defaults are
`127.0.0.1:4400`; `--port` selects the starting port and an occupied port is
followed by the next available port. `--host` can widen binding; widening it
prints a warning because anyone who can reach the address can edit the list.

The app exposes Board (`/`), task detail/edit and mutations under `/tasks`,
Done (`/done`), diagnostics (`/check`), live changes (`/events`) and source
assets (`/assets/*path`). HTML forms use POST/303 and work without JavaScript.
The browser entry listens for file changes and replaces the live region only
when no form has unsaved input; dirty forms show a reload notice instead.

`server.ts` is the composition root. `watch.ts` supplies debounced file
changes; `app/middleware` supplies request capabilities; `app/actions` owns
routes; `app/ui` owns shared rendering and styles. Hosting/authentication,
GitHub-backed storage, move/reorder/remove/group operations and a published
`todo web` command are deferred.
