# `todo web` design

Task 11: add a `todo web` command to the published package that starts the
local web UI. First cut is checkout parity with `bun run web` over one
`FsTodoStore` list; the hub migration (tasks 17/18) rewires it later.

## Scope

In:

- Move `apps/web/{server.ts,watch.ts,app/*,test/*}` into `src/web/` and
  `test/web/`, so git consumers of `@lemol/todo-md` get the command.
- A `todo web [--port] [--host]` subcommand honoring the global `--dir`.
- Root `package.json`, `tsconfig.json`, boundaries test, docs and help-test
  updates the move requires.

Out:

- Hub awareness (`--project`, dashboard, `/p/:project`): task 17.
- Hosting, auth, multi-user, GitHub-backed storage: task 09.
- `todo projects add` branch/list flags, git/jira wiring: tasks 19/06.
- A standalone compiled binary: still later per `tooling.md`.

## Packaging moves

| From | To |
| --- | --- |
| `apps/web/server.ts`, `watch.ts`, `app/**` | `src/web/server.ts`, `watch.ts`, `app/**` |
| `apps/web/test/**` | `test/web/**` |
| `apps/web/package.json`, `apps/web/tsconfig.json` | deleted |
| root `"workspaces": ["apps/*"]`, `"web": "bun apps/web/server.ts"` | deleted (`bun run web` becomes `todo web`) |
| root `"typecheck": "tsc -p tsconfig.json && tsc -p apps/web/tsconfig.json"` | `"typecheck": "tsc -p tsconfig.json"` |

`src/web` imports `spec`, `core` and `fs` through **relative paths**, never
through `@lemol/todo-md/...` (module-graph rule). `test/web` rewrites its
`@lemol/todo-md/core`, `/fs`, `/spec` imports to relative paths too, and may
keep `spec/testing` (runtime code never imports it).

Root `package.json` gains runtime dependencies, all exact like the rest of
the repo: `remix: 3.0.0-rc.2`, `hast-util-to-html`, `mdast-util-to-hast`
(`mdast-util-from-markdown`, `effect`, `@effect/platform-bun` are already
there). Run `bun install` to update `bun.lock`.

## Module graph

`test/boundaries.test.ts`: new rule
`web: { modules: ["spec", "core", "fs"], packages: ["effect", "@effect/platform-bun", "remix", "mdast-util-from-markdown", "mdast-util-to-hast", "hast-util-to-html"] }`
with a server-only carve-out carried over from the current web checker:
only `web/server.ts`, `web/watch.ts` and `web/app/assets.ts` may import
`bun` or `node:*`; no other `src/web` runtime file may. `cli` gains `web`
in its modules. The `webViolations` checker is retired in favor of the
single `violations` table, so every `src/web` and `test/web` file is
scanned by it. `docs/architecture/README.md` module table and `tooling.md`
("published package does not depend on Remix") are updated to the new
shape.

## CLI surface

`todo web` in `src/cli/commands/web.ts`, registered in `src/cli/main.ts`:

- Flags: `--port` (integer, default 4400; outside 1–65535 is a usage
  error, exit 2), `--host` (string, default `127.0.0.1`). The list comes
  from the global `--dir`, else discovery from the working directory
  (`findListRoot`), with the CLI's standard "no todo.md list found"
  message and exit 1.
- `--project` with `web` is a usage error:
  `todo web works on local lists; use --dir` (same shape as `init`/`fmt`).
- `--json` prints `{"url": "http://<host>:<port>"}` instead of the human
  line, then serves.
- Help: description, per-flag descriptions, examples; `test/cli/help.test.ts`
  gains `web` in its command list.
- The startup line and widen-binding warning are byte-identical to today's
  `server.ts`: `http://<host>:<port>`, plus
  `Warning: anyone who can reach this address can edit the list.` when the
  host is not loopback. Occupied ports fall to the next free port.

## Lifecycle

`src/web/server.ts` keeps `resolveRoot`/`startServer` with today's
semantics (watcher, `ManagedRuntime` over `TodoService` +
`FsTodoStore.layer({ root })` + `BunServices.layer`, `createAppRouter`
with `allCapabilities`, `Bun.serve`). The CLI command wraps it in
`Effect.acquireRelease` (release: `app.close()`, runtime dispose,
watcher close, `server.stop()`) followed by `Effect.never`, so Ctrl-C
interrupts the effect and cleanup runs through the layer lifecycle. The
hand-rolled `installSignalHandlers` goes away on the CLI path. Exit code
is 0 while serving; startup failures (no list, bad port) exit 1/2 through
the CLI's existing error mapping.

## tsconfig

Root `tsconfig.json` absorbs what `apps/web/tsconfig.json` added, since
`src/web/*.tsx` now falls under the root `include`:
`lib: ["ES2022", "DOM", "DOM.Iterable"]`, `jsx: "react-jsx"`,
`jsxImportSource: "remix/ui"`. `bun run typecheck` must still pass for all
of `src/`; DOM globals leaking into `src/cli` are acceptable if the gate
is green.

## Tests

- Moved `test/web/*` pass unchanged in behavior (router, SSE, watcher,
  fs-e2e, security, server-options) with `routes.*.href()` URLs intact.
- `test/cli/help.test.ts` covers `web --help` (description, examples,
  every flag described).
- New CLI e2e: `web --port nope` exits 2; `web --project x` exits 2 with
  the local-lists message; both run without binding a port.
- No live-port bind test beyond the existing port-fallback coverage.
- Gate: `bun run check`.

## Docs

- `src/web/README.md` (from `apps/web/README.md`, `todo web` as the entry),
  `src/cli/README.md` command table +1, root `README.md` and `AGENTS.md`
  `bun run web` mentions become `todo web`, `docs/architecture/frontends.md`
  web section (composition root is now the CLI command).

## Done when

- `todo web --dir todo` serves the same pages as `bun run web` did, from a
  clean checkout and from a git-dependency install (no `apps/*` needed).
- `apps/web` is gone; no file outside `src/web` imports Remix.
- `bun run check` passes.
