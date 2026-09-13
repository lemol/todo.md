---
title: Run the web app on the hub
tags: [web, hub]
depends_on: [15]
---
## Goal

Move the web app onto the hub with single-project parity: the same pages
and forms, now under `/p/:project`, with live changes from `hub.changes`.
Delete the web app's own watcher and store wiring. The dashboard and project
management come in task 18.

Design: [hub design §6, Web](../../docs/superpowers/specs/2026-09-13-hub-design.md#web),
[web app design](../../docs/superpowers/specs/2026-09-12-web-app-design.md).

## Scope

In: composition through the hub; project-prefixed routes; per-project
capabilities; SSE over `hub.changes`; deleting `watch.ts` and
`ListChanges`; tests over `memorySource`.

Out: the dashboard at `/`, `/projects`, sync buttons, the project switcher
(task 18); git/jira wiring (19, 06).

## Design

**`server.ts`.** Parse `--project` in addition to `--dir`, `--port` and
`--host` (`--project` with `--dir` is an error, exit 1 with the message).
Build a `ManagedRuntime` from `Hub.layer({ home, userHome, sources:
[fsSource] })` over `BunServices.layer`, with `home` from `$TODO_MD_HOME`
or `~/.todo-md`. Resolve the startup project with `hub.resolve({ project,
dir, cwd })` (same messages as the CLI). Print
`http://<host>:<port>/p/<name>`. Dispose the runtime on shutdown (the
hub's watchers end with it).

**Router.** `createAppRouter({ runtime, author, hosts, startup })` where
`runtime` runs effects needing `Hub`. Remove the `capabilities` and
`changes` options.

- New middleware `loadProject`: for routes under `/p/:project`, runs
  `hub.todo(params.project)`; `ProjectNotFound` → 404 page; other hub
  errors → 500 page with the message. Puts the project's `TodoService`,
  its `capabilities` and its `ProjectInfo` on the context. `runTodo`
  keeps its shape but uses the project's service.
- `GET /` redirects (302) to `/p/<startup>` until task 18 replaces it with
  the dashboard.

**Routes** (`app/routes.ts`): the existing `board`, `done`, `check`, and
`tasks.*` move under `project: route("/p/:project", { … })`. `events` and
`assets` stay at the root. Every `href()` call passes the project.

**Events.** `GET /events` subscribes to `hub.changes` (run through the
runtime into a `ReadableStream`), sends one event per hub change named
after its kind (`event: changed`, as today, plus `synced` and `registry`)
with `data: {"project":"…"}` (empty for `registry`), keeps the 15 s
heartbeat, and unsubscribes when the request aborts. `public/entry.ts` reads the
page's project from a `data-project` attribute on the live region and
reacts only to `changed`/`synced` for that project (and `registry` on no
page yet; task 18 uses it). Keep `refreshDecision` as is.

**Delete** `apps/web/watch.ts`, `apps/web/test/watch.test.ts` (its
scenarios moved to the hub in task 15), `app/middleware/changes.ts` and
`makeFakeChanges`; tests emit through `memorySource`'s `changes` hook
instead.

**Header.** Shows the project name next to the list title.

**Unregistered startup project** (from `--dir` or cwd): works the same; its
name comes from the hub.

## Files

- `apps/web/server.ts`, `app/router.ts`, `app/routes.ts`,
  `app/middleware/todo.ts` (+ new `project.ts`), `app/actions/**`,
  `app/ui/document.tsx`, `app/actions/public/entry.ts`
- Delete `apps/web/watch.ts`, `app/middleware/changes.ts`,
  `test/watch.test.ts`
- `apps/web/test/*` (harness over `Hub.layer` with `memorySource` and a
  temporary home)
- `test/boundaries.test.ts`: web may import `@lemol/todo-md/hub` (and
  `hub/testing` in tests); drop `@lemol/todo-md/fs` if unused;
  `watch.ts` no longer in `serverOnly`
- `apps/web/README.md`

## Tests

- Existing router, route, UI, security and e2e tests pass with URLs under
  `/p/:project` (mechanical updates through `routes.*.href`).
- Unknown project → 404.
- Per-project capabilities: a memorySource project without `groups` or
  `comments` hides that UI (replaces the `capabilities` option test).
- Events: a memorySource change for the page's project is streamed with its
  project name; aborting unsubscribes (the source's watcher stops).
- `fs-e2e.test.ts`: the `FsTodoStore` end-to-end runs through a registered
  fs project in a temporary home.
- Server: `--project` + `--dir` rejected; startup URL includes the project.

## Docs

- `apps/web/README.md`; `docs/architecture/frontends.md` web section
  (hub wiring instead of `watch.ts`).

## Done when

- Web behavior is unchanged apart from URLs and the header.
- No file in `apps/web` implements watching or builds a store.
- `bun run check` passes.
