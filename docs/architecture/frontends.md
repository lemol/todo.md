# Frontends

Frontends are composition roots: they choose adapters, provide platform
services, and present. The logic they run lives in `core` (and, once built,
in the [hub](./hub.md)).

## core, the shared logic

`TodoService` is a layer that requires a `TodoStore` and provides:

- **Queries with derived state:** every task comes back with its state
  (`ready`, `blocked`, `done`) and what it is blocked by.
  - `list(filter)` filters by tag, assignee, group, state and status.
  - `next()` returns the ready tasks in priority order (spec §1.3).
  - `show(id)` returns a task with its dependencies and the tasks it blocks.
- **`check()`:** model validation (`duplicate-id`, `unknown-dependency`,
  `self-dependency`, `dependency-cycle`) merged with the store's
  `diagnostics()`, without reporting the same problem twice.
- **Guarded mutations:**
  - `remove` refuses when open tasks depend on the task, unless forced.
  - Operations the store's capabilities don't include fail early with
    `Unsupported`, before the store is called.
  - `complete` also reports the tasks it made ready.
  - Rejecting new cycles is left to the stores, which must do it
    (spec §1.6).

`core` knows nothing about Markdown, files or any frontend. Details:
[src/core/README.md](../../src/core/README.md).

## cli

The CLI is built with `effect/unstable/cli` (`Command`, `Flag`, `Argument`,
`GlobalFlag`) and runs on `BunRuntime`. Each command resolves the current
project through the hub (`hub.resolve`, then `hub.todo`):

```ts
// context.ts
const withTodo = (f) =>
  Effect.gen(function* () {
    const info = yield* hub.resolve({ project, dir, cwd })
    return yield* f(yield* hub.todo(info.name), info)
  })

// bin.ts
main(process.argv.slice(2), { cwd, env, username, color, home, userHome, sources: [fsSource] }).pipe(
  Effect.tap((code) => Effect.sync(() => { process.exitCode = code })),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
)
```

- **Testable entry point.** `main(args, context)` runs the command tree with
  `Command.runWith` and returns the exit code. Tests pass their own working
  directory, environment, color setting, hub home and sources.
- **Commands:** `list`/`ls` (also plain `todo`), `next`, `show`, `add`,
  `edit`, `done`, `reopen`, `mv`, `rm`, `comment`, `check`, `init`, `fmt`,
  `projects …`, `sync`. The full surface is in the
  [cli README](../../src/cli/README.md).
- **Projects:** `--project <name>` (exclusive with `--dir`); qualified
  `project:id` references (`mionso:12`); `todo projects …` to manage the
  registry; `todo sync` to refresh remotes; `ls`/`next --all` over `overview`.
  Unregistered lists work exactly as before. See the
  [hub design](../superpowers/specs/2026-09-13-hub-design.md#cli).
- **Help:** every command has `--help` with a description, every flag, and
  examples. A test walks the command tree to keep it that way.
- **Output:** human output mirrors `TODO.md`. `--json` (a global flag,
  accepted anywhere) prints the result exactly on stdout, and failures as JSON
  on stderr. Results from a registered project gain its name as `project`.
- **Non-interactive:** the CLI never prompts.
- **Exit codes:** `0` success, `1` domain error (not found, validation,
  `check` found errors, a `sync` with failures), `2` usage error.
- **Comment author:** `--author`, then `$TODO_MD_AUTHOR`, then the OS user
  name.

## web

`src/web` ships in the published package and is served by the `todo web`
command (`src/cli/commands/web.ts`). Composition goes through `Hub.layer`;
routes live under `/p/:project`.

- **Composition root.** `server.ts` builds a `Hub.layer` runtime, resolves
  the startup project the same way the CLI does, and hands it to
  `createAppRouter`. `loadProject` middleware resolves `/p/:project` through
  the hub.
- **Routes.** `GET /` is the cross-project dashboard; `/projects` manages the
  registry; board, tasks, groups, Done and diagnostics sit under `/p/:project`.
  The CLI and the web share `statusText` from the hub for sync-status wording.
- **Live changes.** `/events` streams `hub.changes` as server-sent events.
  Project pages declare their project on the live region; the browser
  re-renders only when an event names that project. Hub pages (dashboard,
  `/projects`) declare the event kinds they listen to instead
  (`data-live-events`); they refresh on any event of those kinds, including
  `registry` events whose payload names no project. There is no `watch.ts` or
  `ListChanges`.
- **UI and design.** Built on `@lemol/ui` (`mini` theme, `Document`,
  `AppShell`, `Nav`, states) and `@lemol/ui/remix` components (`Heading`,
  `Stack`, `Row`, `Grid`, `Text`, `Badge`, `Field`, `Button`, `Dialog`).
  Styling is derived from `miniTheme` via `ThemeStyle` / `css()`.
- **Dialogs and progressive enhancement.** Add task on the board, and Edit and
  Move on the task detail page open as native `<dialog>` modals with invoker
  commands (`command="show-modal"`). Deep links (such as `:id/edit`) and no-JS
  environments fall back gracefully to full-page/inline forms, and 422
  validation errors re-render inline with error feedback.
- **Forms work without JavaScript** (POST, then redirect). The browser
  entry imports `@lemol/ui/remix/compat` to polyfill dialog invokers where
  unsupported, and refreshes the page's live region when the list changes.
- **Security.** Localhost binding, a `Host` allowlist against DNS
  rebinding, and cross-origin protection for unsafe requests.

Details: [src/web/README.md](../../src/web/README.md) and the
[web app design](../superpowers/specs/2026-09-12-web-app-design.md). See
also the [hub design](../superpowers/specs/2026-09-13-hub-design.md#web).

## tui

**Planned (task 20).** A terminal UI over the hub: presentation only, using
`overview`, `todo()` and `changes`.
