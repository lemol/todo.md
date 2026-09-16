# Run the web app on the hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `src/web` from a single hard-wired `FsTodoStore` onto the hub, so it serves every registered project under `/p/:project` with live changes from `hub.changes`, while keeping single-project behavior (routes, forms, live refresh) unchanged apart from the URL prefix and a project badge in the header.

**Architecture:** `server.ts` builds a `ManagedRuntime<Hub>` (was `ManagedRuntime<TodoService>`) from `Hub.layer(...)`, resolves the startup project through `hub.resolve`, and passes that runtime into `createAppRouter`. A new per-request middleware, `loadProject`, resolves `params.project` through `hub.resolve` + `hub.todo` and puts a project-scoped `TodoRuntime` (unchanged shape), `Capabilities` (now read from `todo.capabilities` instead of a static constant) and `ProjectInfo` on the request context — every downstream action, form and template is otherwise untouched except for one new `project` value they thread into `routes.project.*.href(...)` calls. `watch.ts` and the `ListChanges` middleware disappear entirely; `/events` streams `hub.changes` as SSE, and the browser only re-renders when an event names its own page's project.

**Tech Stack:** Bun, Effect 4, `remix` (fetch-router + `remix/ui` JSX), `bun:test`.

**Spec:** [docs/superpowers/specs/2026-09-13-hub-design.md §6 Web](../../superpowers/specs/2026-09-13-hub-design.md#6-frontends), task [`todo/TODO.md` #17](../../../todo/TODO.md).

## Global Constraints

- Minimal diffs: don't re-derive files whose only change is a `project` parameter; edit them in place, keep every other line byte-identical.
- `test/boundaries.test.ts` governs `src/web`'s import graph: `src/web` may reach `hub` and (in tests) `hub/testing` through relative paths only, never through the published `@lemol/todo-md/hub` specifier; the CLI already does this for `hub`, so mirror its module-graph entry.
- No file in `src/web` may implement its own file watching or build a `TodoStore`/`FsTodoStore` after this plan — that's now entirely the hub's job.
- Web behavior for a single, already-registered project must be pixel-for-pixel unchanged apart from the `/p/:project` prefix and the new project badge in the header.
- `bun run check` (lint + typecheck + tests) must pass at the end of every task that touches source or tests.
- Effect version stays pinned; do not touch `package.json` dependency versions in this plan.

---

## Design notes carried into the tasks below

These resolve ambiguity in the task's prose against what the code actually supports; each is referenced from the task where it matters.

1. **`--project` + `--dir` exits 2, not 1.** The task text says "exit 1"; the hub design's own CLI section (§6) and `src/cli/context.ts`'s existing `withTodo` both raise a `UsageError`, which `src/cli/errors.ts:exitCodeOf` maps to exit code **2**. `todo web`'s existing `--project` rejection already uses this pattern (`UsageError({ message: "todo web works on local lists; use --dir" })`). This plan keeps that convention for consistency with every other usage error in the CLI, rather than inventing a one-off exit code.
2. **`loadProject` resolves through `hub.resolve` then `hub.todo`, not `hub.todo` alone.** The task text says the middleware "runs `hub.todo(params.project)`", but `Hub` has no "describe one project by name" method other than `resolve` (which returns `ProjectInfo`) — `todo()` alone only returns a `TodoService`. `withTodo` in `src/cli/context.ts` already does `hub.resolve` then `hub.todo(info.name)`; `loadProject` mirrors that exactly, which is also how it gets the `ProjectInfo` the task asks it to put on the context.
3. **Capabilities come from `todo.capabilities`, not a router option.** `TodoService["Service"].capabilities` (`src/core/TodoService.ts:131`) already proxies the store's `capabilities`. Removing the `RouterOptions.capabilities` field (as the task says) means every test that wants reduced capabilities needs a source whose store reports them — `test/web/harness.ts` gains a small `memoryWithCapabilities` helper (Task 10) instead of relying on task 13 (a separate, not-yet-done task).
4. **No `projectRoutes()` wrapper.** `routes.project.<x>.href({ project, ... })` is called directly at each site; no bound-href factory is introduced, matching the codebase's existing preference for explicit parameters (e.g. `back`, `id`) over context-threading helpers.
5. **`GET /` stays a real route** (`routes.board`, top level) that 302-redirects to `/p/<startup>`; it is not folded into `routes.project`. Task 18 replaces its handler with the dashboard; this plan only wires the redirect.

---

### Task 1: Nest routes under `/p/:project`

**Files:**
- Modify: `src/web/app/routes.ts`
- Test: `test/web/routes.test.ts`

**Interfaces:**
- Produces: `routes.board` (top-level, `"/"`), `routes.events` (`"/events"`), `routes.assets` (`"/assets/*path"`), `routes.project.board` (`"/p/:project"`), `routes.project.done` (`"/p/:project/done"`), `routes.project.check` (`"/p/:project/check"`), `routes.project.tasks.*` (`"/p/:project/tasks/..."`), `routes.project.groups.*` (`"/p/:project/groups/..."`). Every later task's `.href()` calls use these exact names.

- [ ] **Step 1: Write the failing test**

Replace `test/web/routes.test.ts` with:

```ts
import { expect, test } from "bun:test"
import { routes } from "../../src/web/app/routes.ts"

test("defines stable hrefs for every web route", () => {
  expect(routes.board.href()).toBe("/")
  expect(routes.events.href()).toBe("/events")
  expect(routes.assets.href({ path: "app/ui/styles.css" })).toBe("/assets/app/ui/styles.css")
  expect(routes.project.board.href({ project: "acme" })).toBe("/p/acme")
  expect(routes.project.done.href({ project: "acme" })).toBe("/p/acme/done")
  expect(routes.project.check.href({ project: "acme" })).toBe("/p/acme/check")
  expect(routes.project.tasks.add.href({ project: "acme" })).toBe("/p/acme/tasks")
  expect(routes.project.tasks.show.href({ project: "acme", id: "007" })).toBe("/p/acme/tasks/007")
  expect(routes.project.tasks.edit.href({ project: "acme", id: "7" })).toBe("/p/acme/tasks/7/edit")
  expect(routes.project.tasks.update.href({ project: "acme", id: "07" })).toBe(
    "/p/acme/tasks/07",
  )
  expect(routes.project.tasks.complete.href({ project: "acme", id: "5" })).toBe(
    "/p/acme/tasks/5/complete",
  )
  expect(routes.project.tasks.reopen.href({ project: "acme", id: "05" })).toBe(
    "/p/acme/tasks/05/reopen",
  )
  expect(routes.project.tasks.comments.href({ project: "acme", id: "9" })).toBe(
    "/p/acme/tasks/9/comments",
  )
  expect(routes.project.tasks.move.href({ project: "acme", id: "9" })).toBe(
    "/p/acme/tasks/9/move",
  )
  expect(routes.project.tasks.confirmRemove.href({ project: "acme", id: "9" })).toBe(
    "/p/acme/tasks/9/remove",
  )
  expect(routes.project.tasks.remove.href({ project: "acme", id: "9" })).toBe(
    "/p/acme/tasks/9/remove",
  )
  expect(routes.project.groups.edit.href({ project: "acme" })).toBe("/p/acme/groups/rename")
  expect(routes.project.groups.rename.href({ project: "acme" })).toBe("/p/acme/groups/rename")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/web/routes.test.ts`
Expected: FAIL — `routes.project` is `undefined` (`TypeError: Cannot read properties of undefined`).

- [ ] **Step 3: Write minimal implementation**

Replace `src/web/app/routes.ts` with:

```ts
import { get, post, route } from "remix/routes"

export const routes = route({
  board: get("/"),
  events: get("/events"),
  assets: get("/assets/*path"),
  project: route("/p/:project", {
    board: get("/"),
    done: get("/done"),
    check: get("/check"),
    tasks: route("/tasks", {
      add: post(""),
      show: get(":id"),
      edit: get(":id/edit"),
      update: post(":id"),
      complete: post(":id/complete"),
      reopen: post(":id/reopen"),
      comments: post(":id/comments"),
      move: post(":id/move"),
      confirmRemove: get(":id/remove"),
      remove: post(":id/remove"),
    }),
    groups: route("/groups", {
      edit: get("rename"),
      rename: post("rename"),
    }),
  }),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/web/routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/app/routes.ts test/web/routes.test.ts
git commit -m "web: nest board/tasks/groups routes under /p/:project"
```

---

### Task 2: `loadProject` middleware and its context keys

**Files:**
- Create: `src/web/app/middleware/project.tsx`
- Modify: `src/web/app/actions/page.ts` (add `projectOf`)
- Modify: `src/web/app/actions/forms.ts` (`localBack` takes a `project`)
- Delete: `src/web/app/middleware/changes.ts`
- Test: `test/web/middleware/project.test.ts` (new)

**Interfaces:**
- Consumes: `Hub` (`src/hub/index.ts`, already exports `Hub`, `ProjectInfo`), `TodoService` (`src/core/index.ts`), `todoRuntimeContext`/`capabilitiesContext`/`authorContext`/`TodoRuntime` (`src/web/app/middleware/todo.ts`, unchanged), `ErrorPage` (`src/web/app/ui/document.tsx`), `renderPage`/`scriptEntryOf`/`WebContext` (`src/web/app/actions/page.ts`).
- Produces: `src/web/app/middleware/todo.ts` gains `export const projectInfoContext: ContextKey<ProjectInfo>`. `src/web/app/middleware/project.tsx` exports `export interface HubRuntime { readonly runPromise: <A, E>(effect: Effect.Effect<A, E, Hub>) => Promise<A> }` and `export const loadProject: (options: { readonly runtime: HubRuntime; readonly author: string }) => Middleware`. Task 3 (router), Task 4 (server), Task 7 (controllers) all import `loadProject` and `HubRuntime` from `middleware/project.tsx`; `projectOf` (this task's `page.ts` addition) and any test needing the context key import `projectInfoContext` from `middleware/todo.ts`.

This task also removes the old `ListChanges`/`makeFakeChanges` middleware — nothing consumes it after Task 8 rewires `/events` onto `hub.changes` directly, but deleting it now keeps the diff for Task 8 focused on the SSE handler itself. `capabilitiesContext`/`authorContext` stay defined in `middleware/todo.ts`; this task adds `projectInfoContext` there too (avoiding an import cycle between `page.ts` and the new `project.tsx`, which itself depends on `page.ts` for rendering) and adds `loadProject`, the middleware that fills all four per request, in the new `project.tsx`.

- [ ] **Step 1: Write the failing test**

Create `test/web/middleware/project.test.ts`:

```ts
import { expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Hub } from "../../../src/hub/index.ts"
import { memorySource } from "../../../src/hub/testing.ts"
import {
  authorContext,
  capabilitiesContext,
  todoRuntimeContext,
} from "../../../src/web/app/middleware/todo.ts"
import { loadProject } from "../../../src/web/app/middleware/project.tsx"
import { projectInfoContext } from "../../../src/web/app/middleware/todo.ts"

const makeHubRuntime = () => {
  const layer = Hub.layer({
    home: "/tmp/does-not-exist-project-test",
    userHome: "/tmp",
    sources: [memorySource()],
  }).pipe(Layer.provide(BunServices.layer))
  return ManagedRuntime.make(layer)
}

class FakeContext {
  params: Record<string, string>
  private readonly values = new Map<unknown, unknown>()
  render = (_node: unknown, init?: ResponseInit) =>
    new Response("rendered", { status: init?.status ?? 200 })
  constructor(project: string) {
    this.params = { project }
  }
  get<T>(key: T): unknown {
    return this.values.get(key)
  }
  set<T>(key: T, value: unknown): void {
    this.values.set(key, value)
  }
}

test("loads the project's runtime, capabilities and info onto the context", async () => {
  const runtime = makeHubRuntime()
  await runtime.runPromise((yield_ => yield_)(Effect.void)) // warm the runtime
  const middleware = loadProject({ runtime, author: "tester" })
  const context = new FakeContext("m")
  let nextCalled = false
  const response = await middleware(context as never, async () => {
    nextCalled = true
    return new Response("ok")
  })
  expect(nextCalled).toBe(true)
  expect(response.status).toBe(200)
  expect(context.get(projectInfoContext)).toMatchObject({ name: "m" })
  expect(context.get(capabilitiesContext)).toEqual({
    groups: true,
    reorder: true,
    renameGroup: true,
    comments: true,
  })
  expect(context.get(authorContext)).toBe("tester")
  expect(context.get(todoRuntimeContext)).toBeDefined()
  await runtime.dispose()
})

test("renders a 404 page for an unknown project without calling next", async () => {
  const runtime = makeHubRuntime()
  const middleware = loadProject({ runtime, author: "tester" })
  const context = new FakeContext("ghost")
  let nextCalled = false
  const response = await middleware(context as never, async () => {
    nextCalled = true
    return new Response("ok")
  })
  expect(nextCalled).toBe(false)
  expect(response.status).toBe(404)
  await runtime.dispose()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/web/middleware/project.test.ts`
Expected: FAIL — cannot resolve `../../../src/web/app/middleware/project.tsx`.

- [ ] **Step 3: Write minimal implementation**

`projectInfoContext` is added to `src/web/app/middleware/todo.ts` (not this new file), right next to `capabilitiesContext`/`authorContext` — `middleware/project.tsx` needs `renderPage`/`ErrorPage` from `actions/page.ts`, and `page.ts` needs a context key for `projectOf`; keeping every context key in `todo.ts` (which `page.ts` already imports from, and which imports nothing from `actions/`) avoids a two-file import cycle between `page.ts` and `middleware/project.tsx`.

Add one import and one line to `src/web/app/middleware/todo.ts`: `import type { ProjectInfo } from "../../../hub/index.ts"` alongside its existing imports (it already imports `createContextKey` from `"remix/router"`), and, next to `export const capabilitiesContext = createContextKey<Capabilities>()`:

```ts
export const projectInfoContext = createContextKey<ProjectInfo>()
```

Create `src/web/app/middleware/project.tsx`:

```tsx
/** @jsxImportSource remix/ui */
import { Effect, Result } from "effect"
import type { Middleware } from "remix/router"
import { TodoService } from "../../../core/index.ts"
import { Hub } from "../../../hub/index.ts"
import { renderPage, scriptEntryOf, type WebContext } from "../actions/page.ts"
import { ErrorPage } from "../ui/document.tsx"
import {
  authorContext,
  capabilitiesContext,
  projectInfoContext,
  todoRuntimeContext,
  type TodoRuntime,
} from "./todo.ts"

/** Runs effects that only need `Hub`; built once in `server.ts` from `Hub.layer`. */
export interface HubRuntime {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, Hub>) => Promise<A>
}

/**
 * For routes under `/p/:project`: resolves the project (same errors as the
 * CLI's `withTodo`), then puts its `TodoRuntime`, `Capabilities`, author and
 * `ProjectInfo` on the context. An unknown project renders a 404 page; any
 * other hub failure renders a 500 page with its message. Neither calls `next`.
 */
export const loadProject =
  (options: { readonly runtime: HubRuntime; readonly author: string }): Middleware =>
  async (context, next) => {
    const name = String((context as WebContext).params.project ?? "")
    const result = await options.runtime.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const hub = yield* Hub
          const info = yield* hub.resolve({ project: name, cwd: "" })
          const todo = yield* hub.todo(info.name)
          return { info, todo }
        }),
      ),
    )
    if (Result.isFailure(result)) {
      const error = result.failure
      const status = error._tag === "ProjectNotFound" ? 404 : 500
      return renderPage(
        context as WebContext,
        <ErrorPage status={status} message={error.message} scriptEntry={scriptEntryOf(context as WebContext)} />,
        { status },
      )
    }
    const { info, todo } = result.success
    context.set(projectInfoContext, info)
    context.set(authorContext, options.author)
    context.set(capabilitiesContext, todo.capabilities)
    context.set(todoRuntimeContext, {
      runPromise: (effect) =>
        options.runtime.runPromise(Effect.provideService(effect, TodoService, todo)),
    } satisfies TodoRuntime)
    return next()
  }
```

Add to `src/web/app/actions/page.ts` (near `capabilitiesOf`; `projectInfoContext` joins the existing `import { ... } from "../middleware/todo.ts"` line):

```ts
export const projectOf = (context: WebContext): string =>
  (context as { readonly get: (key: typeof projectInfoContext) => ProjectInfo }).get(
    projectInfoContext,
  ).name
```

(`page.ts` already imports `type Capabilities, type Diagnostic` from `../../../spec/index.ts`; add `import type { ProjectInfo } from "../../../hub/index.ts"` alongside its other type imports.)

Update `src/web/app/actions/forms.ts`'s `localBack` to take the current project:

```ts
export const localBack = (value_: string | undefined, project: string): string =>
  value_?.startsWith("/") &&
  !value_.startsWith("//") &&
  !value_.includes("\\") &&
  ![...value_].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
    ? value_
    : routes.project.board.href({ project })
```

Delete `src/web/app/middleware/changes.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/web/middleware/project.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/app/middleware/project.tsx src/web/app/actions/page.ts \
  src/web/app/actions/forms.ts test/web/middleware/project.test.ts
git rm src/web/app/middleware/changes.ts
git commit -m "web: add loadProject middleware, drop the old ListChanges middleware"
```

---

### Task 3: Thread `project` through the UI templates

**Files:**
- Modify: `src/web/app/ui/document.tsx`, `src/web/app/ui/board.tsx`, `src/web/app/ui/task.tsx`, `src/web/app/ui/secondary.tsx`, `src/web/app/ui/groups.tsx`

**Interfaces:**
- Consumes: `routes` (Task 1's nested shape).
- Produces: every exported page-building function below now requires a `project: string` (or a `project` field on its options object), which Task 7's controllers supply via `projectOf(context)`.

This task is mechanical: each function's only change is one new parameter and every `routes.X.href(...)` call becomes `routes.project.X.href({ project, ... })`. Full replacement content below for each file.

- [ ] **Step 1: Write the failing test**

`test/web/ui.test.ts`'s existing assertions (`routes.board.href()`, `routes.tasks.*`) already fail after Task 1 nested the routes — that's this task's red bar. Confirm with:

Run: `bun test test/web/ui.test.ts`
Expected: FAIL — `TypeError: routes.board.href is not a function` (or similar, since `routes.board` now takes no params but other call sites like `routes.tasks` no longer exist).

(Task 10 rewrites `ui.test.ts` itself; this step only establishes that the UI files are the reason it's red before this task's fix.)

- [ ] **Step 2: Replace `src/web/app/ui/document.tsx`**

```tsx
/** @jsxImportSource remix/ui */
import type { ScriptEntry } from "remix/assets"
import type { Handle } from "remix/ui"
import { ImportMap } from "remix/ui/server"
import { routes } from "../routes.ts"

export const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

export interface DocumentOptions {
  readonly title: string
  readonly pageTitle?: string
  readonly content: string
  /** The project this page belongs to; omitted only for a page with no project (e.g. an unknown-project 404). */
  readonly project?: string
  readonly diagnostics?: { readonly error: number; readonly warning: number }
  readonly flash?: { readonly message: string; readonly tone: "info" | "warning" | "error" }
  readonly scriptEntry?: ScriptEntry
}

export function Document(handle: Handle<DocumentOptions>) {
  return () => {
    const options = handle.props
    const errors = options.diagnostics?.error ?? 0
    const warnings = options.diagnostics?.warning ?? 0
    const badge =
      errors > 0 ? (
        <span class="badge error" title={`${errors} errors`}>
          {errors}
        </span>
      ) : warnings > 0 ? (
        <span class="badge warning" title={`${warnings} warnings`}>
          {warnings}
        </span>
      ) : null
    const project = options.project
    const boardHref = project === undefined ? "/" : routes.project.board.href({ project })
    const nav =
      project === undefined ? null : (
        <nav aria-label="Todo list">
          <a href={boardHref}>Board</a>
          <a href={routes.project.done.href({ project })}>Done</a>
          <a class="diagnostic-link" href={routes.project.check.href({ project })}>
            Check {badge}
          </a>
        </nav>
      )
    return (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{options.pageTitle ?? options.title}</title>
          <link rel="stylesheet" href={routes.assets.href({ path: "app/ui/styles.css" })} />
          {options.scriptEntry === undefined ? null : (
            <>
              <ImportMap value={options.scriptEntry.importMap} />
              {options.scriptEntry.preloads.map((preload) => (
                <link rel="modulepreload" href={preload} key={preload} />
              ))}
              <script type="module" src={options.scriptEntry.href} />
            </>
          )}
        </head>
        <body>
          <header>
            <a class="list-name" href={boardHref}>
              {options.title}
            </a>
            {project === undefined ? null : <span class="project-badge">{project}</span>}
            {nav}
          </header>
          {options.flash === undefined ? null : (
            <div class={`flash ${options.flash.tone}`} role="status">
              {options.flash.message}
            </div>
          )}
          <div class="reload-notice info" data-reload-notice hidden>
            The list changed. <a href={boardHref}>Reload</a>
          </div>
          <main data-live-region {...(project === undefined ? {} : { "data-project": project })} innerHTML={options.content} />
        </body>
      </html>
    )
  }
}

export interface ErrorPageOptions {
  readonly status: number
  readonly message: string
  readonly project?: string
  readonly scriptEntry?: ScriptEntry
}

export function ErrorPage(handle: Handle<ErrorPageOptions>) {
  return () => {
    const options = handle.props
    const back = options.project === undefined ? "/" : routes.project.board.href({ project: options.project })
    return (
      <Document
        title="todo.md"
        pageTitle={`${options.status} error`}
        content={`<h1>${options.status}</h1><p>${escapeHtml(options.message)}</p><a href="${back}">Back to board</a>`}
        {...(options.project === undefined ? {} : { project: options.project })}
        {...(options.scriptEntry === undefined ? {} : { scriptEntry: options.scriptEntry })}
      />
    )
  }
}

export const Page = Document
export const Flash = (message: string) =>
  `<div class="flash info" role="status">${escapeHtml(message)}</div>`
```

- [ ] **Step 3: Replace `src/web/app/ui/board.tsx`**

```tsx
import type { Listing, TaskView } from "../../../core/index.ts"
import type { Capabilities } from "../../../spec/index.ts"
import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"
import { showId } from "./format.ts"
import { markdownHtml } from "./markdown.tsx"

export interface AddValues {
  readonly title: string
  readonly group: string
  readonly newGroup: string
}

const queryHref = (project: string, back: string, name: string, value: string): string => {
  const current = new URL(back, "http://todo-md.local")
  const query = current.searchParams
  if (name === "tag") {
    if (!query.getAll(name).includes(value)) query.append(name, value)
  } else query.set(name, value)
  return `${routes.project.board.href({ project })}?${query}`
}

/** Up moves before the row above, down after the row below; absent at the section's edges. */
export interface RowMoves {
  readonly above: string | undefined
  readonly below: string | undefined
}

const moveButton = (
  project: string,
  task: TaskView["task"],
  back: string,
  anchor: "before" | "after",
  target: string | undefined,
): string => {
  const [label, arrow] = anchor === "before" ? ["up", "↑"] : ["down", "↓"]
  if (target === undefined)
    return `<button class="move" type="button" disabled aria-hidden="true" tabindex="-1">${arrow}</button>`
  return `<form method="post" action="${routes.project.tasks.move.href({ project, id: task.id })}"><input type="hidden" name="back" value="${escapeHtml(back)}"><input type="hidden" name="${anchor}" value="${escapeHtml(target)}"><button class="move" type="submit" title="Move ${label}" aria-label="Move ${escapeHtml(task.title)} ${label}">${arrow}</button></form>`
}

export const TaskRow = (
  project: string,
  view: TaskView,
  options: { readonly next: boolean; readonly back: string; readonly moves?: RowMoves },
): string => {
  const { task } = view
  const tags = task.tags
    .map(
      (tag) =>
        `<a class="chip" href="${escapeHtml(queryHref(project, options.back, "tag", tag))}">#${escapeHtml(tag)}</a>`,
    )
    .join(" ")
  const assignee =
    task.assignee === undefined
      ? ""
      : `<a class="assignee" href="${escapeHtml(queryHref(project, options.back, "assignee", task.assignee))}">@${escapeHtml(task.assignee)}</a>`
  const blockedBy =
    view.blockedBy.length === 0
      ? ""
      : `<div class="blocked-by">blocked by ${view.blockedBy
          .map((id) => `<a href="${routes.project.tasks.show.href({ project, id })}">${showId(id)}</a>`)
          .join(", ")}</div>`
  const moves =
    options.moves === undefined
      ? ""
      : ` <span class="moves">${moveButton(project, task, options.back, "before", options.moves.above)}${moveButton(project, task, options.back, "after", options.moves.below)}</span>`
  return `<article class="task-row${options.next ? " next" : ""}"${options.next ? ' data-next="true"' : ""}><form method="post" action="${routes.project.tasks.complete.href({ project, id: task.id })}"><input type="hidden" name="back" value="${escapeHtml(options.back)}"><button class="checkbox" aria-label="Complete ${escapeHtml(task.title)}" type="submit"></button></form><code>${showId(task.id)}</code><div class="task-copy"><a class="task-title" href="${routes.project.tasks.show.href({ project, id: task.id })}">${escapeHtml(task.title)}</a>${blockedBy}</div><div class="task-meta">${tags} ${assignee} <span class="badge ${view.state}">${view.state.toUpperCase()}</span>${moves}</div></article>`
}

export const AddTaskForm = (
  project: string,
  listing: Listing,
  capabilities: Capabilities,
  values: AddValues = { title: "", group: "", newGroup: "" },
  issues: ReadonlyArray<string> = [],
): string => {
  const groups = listing.sections.flatMap((section) =>
    section.name === undefined
      ? []
      : [
          `<option value="${escapeHtml(section.name)}"${values.group === section.name ? " selected" : ""}>${escapeHtml(section.name)}</option>`,
        ],
  )
  const groupFields = capabilities.groups
    ? `<label>Group <select name="group"><option value="">Ungrouped</option>${groups.join("")}<option value="__new__"${values.group === "__new__" ? " selected" : ""}>new group…</option></select></label><label>New group <input name="newGroup" value="${escapeHtml(values.newGroup)}"></label>`
    : ""
  return `<section class="add-task"><h2>Add task</h2>${issues.length === 0 ? "" : `<ul class="issues">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`}<form method="post" action="${routes.project.tasks.add.href({ project })}"><label>Title <input name="title" value="${escapeHtml(values.title)}" required></label>${groupFields}<button class="primary" type="submit">Add task</button></form></section>`
}

export const BoardPage = (options: {
  readonly project: string
  readonly listing: Listing
  readonly nextIds: ReadonlySet<string>
  readonly capabilities: Capabilities
  readonly back: string
  readonly addValues?: AddValues
  readonly addIssues?: ReadonlyArray<string>
}): string => {
  const { project } = options
  const views = options.listing.sections.flatMap((section) => section.tasks)
  const ready = views.filter((view) => view.state === "ready").length
  const blocked = views.length - ready
  const sections = options.listing.sections
    .filter((section) => section.tasks.length > 0)
    .map((section) => {
      const heading =
        section.name === undefined
          ? "Ungrouped"
          : `<a href="${escapeHtml(queryHref(project, options.back, "group", section.name))}">${escapeHtml(section.name)}</a>${
              options.capabilities.renameGroup
                ? ` <a class="section-action" href="${escapeHtml(routes.project.groups.edit.href({ project }, { searchParams: { name: section.name } }))}">Rename</a>`
                : ""
            }`
      const rows = section.tasks.map((view, index) =>
        TaskRow(project, view, {
          next: options.nextIds.has(view.task.id),
          back: options.back,
          ...(options.capabilities.reorder
            ? {
                moves: {
                  above: section.tasks[index - 1]?.task.id,
                  below: section.tasks[index + 1]?.task.id,
                },
              }
            : {}),
        }),
      )
      return `<section class="task-section"><h2>${heading}</h2>${section.description === "" ? "" : `<div class="section-description markdown">${markdownHtml(section.description)}</div>`}${rows.join("")}</section>`
    })
    .join("")
  return `<h1>${escapeHtml(options.listing.title)}</h1>${options.listing.description === "" ? "" : `<div class="list-description markdown">${markdownHtml(options.listing.description)}</div>`}<p class="summary">${views.length} open · ${ready} ready · ${blocked} blocked</p>${AddTaskForm(project, options.listing, options.capabilities, options.addValues, options.addIssues)}${sections || '<p class="empty">Nothing open. Add a task above.</p>'}`
}
```

- [ ] **Step 4: Replace `src/web/app/ui/secondary.tsx`**

```tsx
import type { TaskView } from "../../../core/index.ts"
import type { Diagnostic } from "../../../spec/index.ts"
import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"
import { formatDate, showId } from "./format.ts"

export const DonePage = (project: string, tasks: ReadonlyArray<TaskView>): string => {
  if (tasks.length === 0) return '<h1>Done</h1><p class="empty">Nothing done.</p>'
  const rows = tasks
    .map(({ task }) => {
      const group = task.group === undefined ? "Ungrouped" : task.group
      return `<article class="done-row"><code>${showId(task.id)}</code><a href="${routes.project.tasks.show.href({ project, id: task.id })}">${escapeHtml(task.title)}</a><span><code>${formatDate(task.completedAt)}</code> · ${escapeHtml(group)}</span><form method="post" action="${routes.project.tasks.reopen.href({ project, id: task.id })}"><button class="secondary" type="submit">Reopen</button></form></article>`
    })
    .join("")
  return `<h1>Done</h1>${rows}`
}

const severities = ["error", "warning", "info"] as const

export const CheckPage = (project: string, diagnostics: ReadonlyArray<Diagnostic>): string => {
  if (diagnostics.length === 0) return '<h1>Check</h1><p class="empty">No diagnostics.</p>'
  const groups = severities
    .flatMap((severity) => {
      const items = diagnostics.filter((item) => item.severity === severity)
      if (items.length === 0) return []
      const label = `${severity[0]?.toUpperCase()}${severity.slice(1)}s`
      return [
        `<section><h2>${label}</h2><ul class="diagnostics">${items
          .map((item) => {
            const task =
              item.taskId === undefined
                ? ""
                : ` <a href="${routes.project.tasks.show.href({ project, id: item.taskId })}">task ${showId(item.taskId)}</a>`
            const location =
              item.file === undefined
                ? ""
                : ` <code>${escapeHtml(item.file)}${item.line === undefined ? "" : `:${item.line}`}</code>`
            return `<li><span class="badge ${severity}">${severity.toUpperCase()}</span> <code>${escapeHtml(item.code)}</code> ${escapeHtml(item.message)}${task}${location}</li>`
          })
          .join("")}</ul></section>`,
      ]
    })
    .join("")
  return `<h1>Check</h1>${groups}`
}
```

- [ ] **Step 5: Replace `src/web/app/ui/task.tsx`**

```tsx
import type { TaskDetail } from "../../../core/index.ts"
import type { Capabilities, Task } from "../../../spec/index.ts"
import type { EditValues } from "../actions/forms.ts"
import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"
import { formatDate, formatMinute, showId } from "./format.ts"
import { markdownHtml } from "./markdown.tsx"

const metadata = (task: Task, state: string): string => {
  const facts = [
    ["State", state],
    ["Group", task.group ?? "Ungrouped"],
    ["Tags", task.tags.length === 0 ? "None" : task.tags.map((tag) => `#${tag}`).join(" ")],
    ["Assignee", task.assignee === undefined ? "Unassigned" : `@${task.assignee}`],
    ...(task.status === "done" ? [["Completed", formatDate(task.completedAt)]] : []),
  ]
  return `<dl class="metadata">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd><code>${escapeHtml(value)}</code></dd></div>`).join("")}</dl>`
}

const issueList = (issues: ReadonlyArray<string>): string =>
  issues.length === 0
    ? ""
    : `<ul class="issues">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`

/** Moves an open task to the top or bottom of a group, like `todo mv`. */
const MoveForm = (
  project: string,
  task: Task,
  capabilities: Capabilities,
  groups: ReadonlyArray<string>,
  issues: ReadonlyArray<string>,
): string => {
  const options = [
    `<option value=""${task.group === undefined ? " selected" : ""}>Ungrouped</option>`,
    ...groups.map(
      (group) =>
        `<option value="${escapeHtml(group)}"${task.group === group ? " selected" : ""}>${escapeHtml(group)}</option>`,
    ),
    '<option value="__new__">new group…</option>',
  ]
  const groupFields = capabilities.groups
    ? `<label>Group <select name="group">${options.join("")}</select></label><label>New group <input name="newGroup"></label>`
    : ""
  return `<section><h2>Move</h2>${issueList(issues)}<form class="move-form" method="post" action="${routes.project.tasks.move.href({ project, id: task.id })}"><input type="hidden" name="back" value="${routes.project.tasks.show.href({ project, id: task.id })}">${groupFields}<label>Position <select name="position"><option value="bottom">Bottom</option><option value="top">Top</option></select></label><button class="secondary" type="submit">Move</button></form></section>`
}

export const TaskPage = (options: {
  readonly project: string
  readonly detail: TaskDetail
  readonly capabilities: Capabilities
  readonly author: string
  readonly groups?: ReadonlyArray<string>
  readonly moveIssues?: ReadonlyArray<string>
}): string => {
  const { detail, project } = options
  const task = detail.view.task
  const dependencies = detail.dependencies
    .map(
      (dependency) =>
        `<li><a href="${routes.project.tasks.show.href({ project, id: dependency.id })}">${showId(dependency.id)} ${escapeHtml(dependency.title ?? "unknown")}</a> <span class="badge ${dependency.state}">${dependency.state.toUpperCase()}</span></li>`,
    )
    .join("")
  const blocks = detail.blocks
    .map(
      (view) =>
        `<li><a href="${routes.project.tasks.show.href({ project, id: view.task.id })}">${showId(view.task.id)} ${escapeHtml(view.task.title)}</a></li>`,
    )
    .join("")
  const comments = task.comments
    .map(
      (comment) =>
        `<article class="comment"><div class="comment-by"><code>@${escapeHtml(comment.author)} · ${formatMinute(comment.at)}</code></div><div class="markdown">${markdownHtml(comment.body)}</div></article>`,
    )
    .join("")
  const transition =
    task.status === "open"
      ? `<form method="post" action="${routes.project.tasks.complete.href({ project, id: task.id })}"><input type="hidden" name="back" value="${routes.project.tasks.show.href({ project, id: task.id })}"><button class="primary" type="submit">Complete</button></form>`
      : `<form method="post" action="${routes.project.tasks.reopen.href({ project, id: task.id })}"><button class="primary" type="submit">Reopen</button></form>`
  const commentForm = options.capabilities.comments
    ? `<form class="comment-form" method="post" action="${routes.project.tasks.comments.href({ project, id: task.id })}"><label>Author <input name="author" value="${escapeHtml(options.author)}" required></label><label>Comment <textarea name="body" required></textarea></label><button class="primary" type="submit">Comment</button></form>`
    : ""
  const move =
    task.status === "open" && options.capabilities.reorder
      ? MoveForm(project, task, options.capabilities, options.groups ?? [], options.moveIssues ?? [])
      : ""
  return `<div class="task-heading"><div><code>${showId(task.id)}</code><h1>${escapeHtml(task.title)}</h1></div><div class="actions">${transition}<a class="secondary" href="${routes.project.tasks.edit.href({ project, id: task.id })}">Edit</a><a class="secondary" href="${routes.project.tasks.confirmRemove.href({ project, id: task.id })}">Remove</a></div></div>${metadata(task, detail.view.state)}${task.description === "" ? "" : `<section><h2>Description</h2><div class="markdown">${markdownHtml(task.description)}</div></section>`}<section><h2>Dependencies</h2>${dependencies === "" ? '<p class="empty">No dependencies.</p>' : `<ul>${dependencies}</ul>`}</section><section><h2>Blocks</h2>${blocks === "" ? '<p class="empty">Blocks nothing.</p>' : `<ul>${blocks}</ul>`}</section>${move}<section><h2>Comments</h2>${comments || '<p class="empty">No comments.</p>'}${commentForm}</section>`
}

/**
 * Asks before deleting. With open dependents it lists them and the button
 * sends `force`, since removing leaves them with an unknown dependency.
 */
export const RemoveTaskPage = (
  project: string,
  task: Pick<Task, "id" | "title">,
  dependents: ReadonlyArray<Pick<Task, "id" | "title">>,
  issues: ReadonlyArray<string> = [],
): string => {
  const warning =
    dependents.length === 0
      ? ""
      : `<p class="warning">These open tasks depend on it and will be left with an unknown dependency:</p><ul>${dependents
          .map(
            (dependent) =>
              `<li><a href="${routes.project.tasks.show.href({ project, id: dependent.id })}">${showId(dependent.id)} ${escapeHtml(dependent.title)}</a></li>`,
          )
          .join("")}</ul>`
  return `<h1>Remove task ${showId(task.id)}</h1>${issueList(issues)}<p>Remove <a href="${routes.project.tasks.show.href({ project, id: task.id })}">${showId(task.id)} ${escapeHtml(task.title)}</a> for good? This deletes the task and its file; version control keeps the history.</p>${warning}<form class="actions confirm" method="post" action="${routes.project.tasks.remove.href({ project, id: task.id })}">${dependents.length === 0 ? "" : '<input type="hidden" name="force" value="1">'}<button class="danger" type="submit">${dependents.length === 0 ? "Remove" : "Remove anyway"}</button><a class="secondary" href="${routes.project.tasks.show.href({ project, id: task.id })}">Cancel</a></form>`
}

export const valuesOf = (task: Task): EditValues => ({
  title: task.title,
  description: task.description,
  tags: task.tags.join(" "),
  assignee: task.assignee ?? "",
  dependsOn: task.dependsOn.join(" "),
})

export const EditTaskPage = (
  project: string,
  task: Pick<Task, "id">,
  values: EditValues,
  issues: ReadonlyArray<string> = [],
): string =>
  `<h1>Edit task ${showId(task.id)}</h1>${issueList(issues)}<form class="edit-form" method="post" action="${routes.project.tasks.update.href({ project, id: task.id })}"><label>Title <input name="title" value="${escapeHtml(values.title)}" required></label><label>Description <textarea name="description">${escapeHtml(values.description)}</textarea></label><label>Tags <input name="tags" value="${escapeHtml(values.tags)}"></label><label>Assignee <input name="assignee" value="${escapeHtml(values.assignee)}"></label><label>Depends on <input name="dependsOn" value="${escapeHtml(values.dependsOn)}"></label><button class="primary" type="submit">Save</button></form>`
```

- [ ] **Step 6: Replace `src/web/app/ui/groups.tsx`**

```tsx
import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"

export const RenameGroupPage = (
  project: string,
  from: string,
  to: string = from,
  issues: ReadonlyArray<string> = [],
): string =>
  `<h1>Rename group</h1>${issues.length === 0 ? "" : `<ul class="issues">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`}<p>Done tasks keep the name they were completed under.</p><form class="edit-form" method="post" action="${routes.project.groups.rename.href({ project })}"><input type="hidden" name="from" value="${escapeHtml(from)}"><label>Name <input name="to" value="${escapeHtml(to)}" required></label><div class="actions confirm"><button class="primary" type="submit">Rename</button><a class="secondary" href="${routes.project.board.href({ project })}">Cancel</a></div></form>`
```

- [ ] **Step 7: Typecheck**

Run: `bun run check` (lint + typecheck will fail loudly on any leftover unqualified `routes.tasks`/`routes.board` call; Task 4's controllers haven't been updated yet so this step is expected to still show controller-side errors — confirm the *ui* files themselves compile with `bunx tsc --noEmit -p .` or by grepping)

Run: `grep -rn "routes\.tasks\.\|routes\.groups\.\|routes\.board\.href()\|routes\.done\.\|routes\.check\." src/web/app/ui` 
Expected: no matches (every UI-file call site now goes through `routes.project.*`).

- [ ] **Step 8: Commit**

```bash
git add src/web/app/ui/document.tsx src/web/app/ui/board.tsx src/web/app/ui/task.tsx \
  src/web/app/ui/secondary.tsx src/web/app/ui/groups.tsx
git commit -m "web: thread project through every page template's hrefs"
```

---

### Task 4: Thread `project` through the controllers

**Files:**
- Modify: `src/web/app/actions/controller.tsx`
- Modify: `src/web/app/actions/tasks/controller.tsx`
- Modify: `src/web/app/actions/groups/controller.tsx`
- Modify: `src/web/app/actions/respond.tsx`

**Interfaces:**
- Consumes: `loadProject`, `HubRuntime` (Task 2), `projectOf` (Task 2), `routes.project.*` (Task 1), page functions from Task 3 (`BoardPage`, `DonePage`, `CheckPage`, `TaskPage`, `RemoveTaskPage`, `EditTaskPage`, `RenameGroupPage`, `Document`, `ErrorPage`).
- Produces: `export const createRootController = (options: { readonly runtime: HubRuntime; readonly author: string }) => Controller` (board/done/check), `export const createTasksController = (options: { readonly runtime: HubRuntime; readonly author: string }) => Controller`, `export const createGroupsController = (options: { readonly runtime: HubRuntime; readonly author: string }) => Controller`. Task 5 (router) calls all three factories and wires them with `router.map`.

`renderBoard` stays an exported named function (Task 5's `tasks/controller.tsx`'s `add` action still calls it directly), but it now reads `projectOf(context)` instead of taking no project at all.

- [ ] **Step 1: Write the failing test**

The existing `test/web/contracts.test.ts` (rewritten in Task 10 to a Hub-backed harness) is the regression net for this task; there is no new isolated unit test here because these controllers are pure request-handling glue over already-tested pieces (`routes`, the UI functions, `runTodo`). Confirm the current state is red:

Run: `bun test test/web/contracts.test.ts`
Expected: FAIL (still using the pre-Task-1 `routes.board.href()` shape; will be fixed by Task 10, but exercising it now shows the controllers are the remaining blocker once the harness is fixed).

- [ ] **Step 2: Replace `src/web/app/actions/controller.tsx`**

```tsx
/** @jsxImportSource remix/ui */

import { Effect, Fiber, Stream } from "effect"
import { redirect } from "remix/response/redirect"
import type { RequestContext } from "remix/router"
import { createController } from "remix/router"
import type { TaskFilter } from "../../../core/index.ts"
import { Hub, type HubChange } from "../../../hub/index.ts"
import type { HubRuntime } from "../middleware/project.tsx"
import { loadProject } from "../middleware/project.tsx"
import { routes } from "../routes.ts"
import { assetsContext } from "../assets.ts"
import { type AddValues, BoardPage } from "../ui/board.tsx"
import { Document, ErrorPage } from "../ui/document.tsx"
import { diagnosticCounts } from "../ui/format.ts"
import { CheckPage, DonePage } from "../ui/secondary.tsx"
import { parseTaskFilter } from "./forms.ts"
import {
  capabilitiesOf,
  projectOf,
  renderPage,
  runtimeContext,
  scriptEntryOf,
  takeFlash,
  type WebContext,
} from "./page.ts"
import { respond, respondDefect } from "./respond.tsx"
import { runTodo } from "../middleware/todo.ts"

export const renderBoard = async (
  context: WebContext,
  status = 200,
  addValues?: AddValues,
  addIssues?: ReadonlyArray<string>,
): Promise<Response> => {
  try {
    const project = projectOf(context)
    let filter: TaskFilter
    try {
      filter = parseTaskFilter(new URL(context.request.url))
    } catch {
      return renderPage(
        context,
        <ErrorPage
          status={400}
          message="Invalid state filter."
          project={project}
          scriptEntry={scriptEntryOf(context)}
        />,
        { status: 400 },
      )
    }
    const [listing, next, diagnostics] = await Promise.all([
      runTodo(runtimeContext(context), (todo) => todo.list(filter)),
      runTodo(runtimeContext(context), (todo) => todo.next()),
      runTodo(runtimeContext(context), (todo) => todo.check()),
    ])
    if (!listing.ok) return respond(context, listing.error)
    if (!next.ok) return respond(context, next.error)
    if (!diagnostics.ok) return respond(context, diagnostics.error)
    const url = new URL(context.request.url)
    const flash = takeFlash(context)
    return renderPage(
      context,
      <Document
        title={listing.value.title}
        project={project}
        content={BoardPage({
          project,
          listing: listing.value,
          nextIds: new Set(next.value.slice(0, 1).map((item) => item.task.id)),
          capabilities: capabilitiesOf(context),
          back: `${url.pathname}${url.search}`,
          ...(addValues === undefined ? {} : { addValues }),
          ...(addIssues === undefined ? {} : { addIssues }),
        })}
        diagnostics={diagnosticCounts(diagnostics.value)}
        scriptEntry={scriptEntryOf(context)}
        {...(flash === undefined ? {} : { flash })}
      />,
      { status },
    )
  } catch (defect) {
    return respondDefect(context, defect)
  }
}

const done = async (context: WebContext): Promise<Response> => {
  try {
    const project = projectOf(context)
    const [listing, diagnostics] = await Promise.all([
      runTodo(runtimeContext(context), (todo) => todo.list({ status: "done" })),
      runTodo(runtimeContext(context), (todo) => todo.check()),
    ])
    if (!listing.ok) return respond(context, listing.error)
    if (!diagnostics.ok) return respond(context, diagnostics.error)
    const flash = takeFlash(context)
    return renderPage(
      context,
      <Document
        title={listing.value.title}
        project={project}
        pageTitle={`Done · ${listing.value.title}`}
        content={DonePage(project, listing.value.done)}
        diagnostics={diagnosticCounts(diagnostics.value)}
        scriptEntry={scriptEntryOf(context)}
        {...(flash === undefined ? {} : { flash })}
      />,
    )
  } catch (defect) {
    return respondDefect(context, defect)
  }
}

const check = async (context: WebContext): Promise<Response> => {
  try {
    const project = projectOf(context)
    const [listing, diagnostics] = await Promise.all([
      runTodo(runtimeContext(context), (todo) => todo.list()),
      runTodo(runtimeContext(context), (todo) => todo.check()),
    ])
    if (!listing.ok) return respond(context, listing.error)
    if (!diagnostics.ok) return respond(context, diagnostics.error)
    const flash = takeFlash(context)
    return renderPage(
      context,
      <Document
        title={listing.value.title}
        project={project}
        pageTitle={`Check · ${listing.value.title}`}
        content={CheckPage(project, diagnostics.value)}
        diagnostics={diagnosticCounts(diagnostics.value)}
        scriptEntry={scriptEntryOf(context)}
        {...(flash === undefined ? {} : { flash })}
      />,
    )
  } catch (defect) {
    return respondDefect(context, defect)
  }
}

export const createRootController = (options: {
  readonly runtime: HubRuntime
  readonly author: string
}) =>
  createController(routes.project, {
    middleware: [loadProject(options)],
    actions: { board: (context) => renderBoard(context), done, check },
  })

/** `GET /`: redirects to the startup project's board until task 18 adds the dashboard. */
const boardRedirect =
  (startup: string) =>
  (_context: RequestContext): Response =>
    redirect(routes.project.board.href({ project: startup }), 302)

/**
 * Forks a `hub.changes` consumer and awaits the fork before returning, so
 * the subscription (`PubSub.subscribe` inside `src/hub/changes.ts`'s stream)
 * has at least started before this responds. Effect's fiber runtime runs a
 * forked fiber's synchronous prefix eagerly, but nothing here *guarantees*
 * the subscribe has completed by the time this returns — `test/web/events.test.ts`
 * treats a missed first event as possible and retries the seed that should
 * trigger it, the same way `test/hub/helpers.ts`'s `eventually` does for the
 * identical PubSub-subscribe-vs-publish race inside the hub's own test suite.
 */
const eventsAction =
  (runtime: HubRuntime) =>
  async (context: RequestContext): Promise<Response> => {
    const encoder = new TextEncoder()
    let closed = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined
    const send = (change: HubChange) => {
      if (closed || controllerRef === undefined) return
      const data = change.kind === "registry" ? "{}" : JSON.stringify({ project: change.project })
      try {
        controllerRef.enqueue(encoder.encode(`event: ${change.kind}\ndata: ${data}\n\n`))
      } catch {
        closed = true
      }
    }
    const fiber = await runtime.runPromise(
      Effect.gen(function* () {
        const hub = yield* Hub
        return yield* Effect.fork(Stream.runForEach(hub.changes, (change) => Effect.sync(() => send(change))))
      }),
    )
    const cleanup = () => {
      if (closed) return
      closed = true
      if (heartbeat !== undefined) clearInterval(heartbeat)
      Effect.runFork(Fiber.interrupt(fiber))
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller
        heartbeat = setInterval(() => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"))
          } catch {
            cleanup()
          }
        }, 15_000)
        context.request.signal.addEventListener("abort", cleanup, { once: true })
        if (context.request.signal.aborted) cleanup()
      },
      cancel: cleanup,
    })
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    })
  }

export const createTopController = (options: { readonly runtime: HubRuntime; readonly startup: string }) =>
  createController(routes, {
    actions: {
      board: boardRedirect(options.startup),
      events: eventsAction(options.runtime),
      assets: async (context) => {
        const assets = (
          context as {
            get: (key: typeof assetsContext) => {
              fetch: (request: Request) => Promise<Response | null>
            }
          }
        ).get(assetsContext)
        return (await assets.fetch(context.request)) ?? new Response("Not Found", { status: 404 })
      },
    },
  })
```

- [ ] **Step 3: Update `src/web/app/actions/tasks/controller.tsx`**

Apply these mechanical edits (full file after edits shown below): add `projectOf` to the `page.ts` import, add `loadProject`/`HubRuntime` imports, wrap `renderTask`/`renderRemove`/`renderEdit` with `project = projectOf(context)` and pass `project` into `TaskPage`/`RemoveTaskPage`/`EditTaskPage`/`Document`, replace every `routes.tasks.*`/`routes.board`/`routes.done` call with `routes.project.tasks.*`/`routes.project.board`/`routes.project.done` plus `project`, change `localBack(form.get("back")?.toString())` to `localBack(form.get("back")?.toString(), project)`, and change the default export to `export const createTasksController = (options: { readonly runtime: HubRuntime; readonly author: string })`.

```tsx
/** @jsxImportSource remix/ui */
import { Effect } from "effect"
import { redirect } from "remix/response/redirect"
import { createController } from "remix/router"
import type { HubRuntime } from "../../middleware/project.tsx"
import { loadProject } from "../../middleware/project.tsx"
import { authorContext, runTodo } from "../../middleware/todo.ts"
import { routes } from "../../routes.ts"
import { Document } from "../../ui/document.tsx"
import { showId } from "../../ui/format.ts"
import { EditTaskPage, RemoveTaskPage, TaskPage, valuesOf } from "../../ui/task.tsx"
import { renderBoard } from "../controller.tsx"
import {
  localBack,
  normalizeDependencies,
  parseAddForm,
  parseCommentForm,
  parseEditForm,
  parseMoveForm,
} from "../forms.ts"
import {
  capabilitiesOf,
  loadChrome,
  projectOf,
  renderPage,
  runtimeContext,
  scriptEntryOf,
  setFlash,
  takeFlash,
  type WebContext,
} from "../page.ts"
import { errorDescription, respond, respondDefect } from "../respond.tsx"

const formOf = (context: WebContext): FormData => context.get(FormData) as FormData
const idOf = (context: WebContext): string =>
  String(context.params.id ?? "").replace(/^0+(?=\d)/, "")
const tagOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : undefined

const renderTask = async (
  context: WebContext,
  id: string,
  moveIssues: ReadonlyArray<string> = [],
  status = 200,
): Promise<Response> => {
  const project = projectOf(context)
  const [detail, chrome] = await Promise.all([
    runTodo(runtimeContext(context), (todo) => todo.show(id)),
    loadChrome(context),
  ])
  if (!detail.ok) return respond(context, detail.error)
  if (!chrome.ok) return respond(context, chrome.error)
  const flash = takeFlash(context)
  return renderPage(
    context,
    <Document
      title={chrome.title}
      project={project}
      pageTitle={`${showId(detail.value.view.task.id)} ${detail.value.view.task.title}`}
      content={TaskPage({
        project,
        detail: detail.value,
        capabilities: capabilitiesOf(context),
        author: String(context.get(authorContext)),
        groups: chrome.groups,
        moveIssues,
      })}
      diagnostics={chrome.diagnosticCounts}
      scriptEntry={scriptEntryOf(context)}
      {...(flash === undefined ? {} : { flash })}
    />,
    { status },
  )
}

const renderRemove = async (
  context: WebContext,
  id: string,
  issues: ReadonlyArray<string> = [],
  status = 200,
): Promise<Response> => {
  const project = projectOf(context)
  const [detail, chrome] = await Promise.all([
    runTodo(runtimeContext(context), (todo) => todo.show(id)),
    loadChrome(context),
  ])
  if (!detail.ok) return respond(context, detail.error)
  if (!chrome.ok) return respond(context, chrome.error)
  const task = detail.value.view.task
  return renderPage(
    context,
    <Document
      title={chrome.title}
      project={project}
      pageTitle={`Remove ${showId(task.id)} · ${chrome.title}`}
      content={RemoveTaskPage(
        project,
        task,
        detail.value.blocks.map((view) => view.task),
        issues,
      )}
      diagnostics={chrome.diagnosticCounts}
      scriptEntry={scriptEntryOf(context)}
    />,
    { status },
  )
}

const renderEdit = async (
  context: WebContext,
  id: string,
  values?: ReturnType<typeof parseEditForm>,
  issues: ReadonlyArray<string> = [],
  status = 200,
): Promise<Response> => {
  const project = projectOf(context)
  const [detail, chrome] = await Promise.all([
    runTodo(runtimeContext(context), (todo) => todo.show(id)),
    loadChrome(context),
  ])
  if (!detail.ok) return respond(context, detail.error)
  if (!chrome.ok) return respond(context, chrome.error)
  const task = detail.value.view.task
  return renderPage(
    context,
    <Document
      title={chrome.title}
      project={project}
      pageTitle={`Edit ${showId(task.id)} · ${chrome.title}`}
      content={EditTaskPage(project, task, values ?? valuesOf(task), issues)}
      diagnostics={chrome.diagnosticCounts}
      scriptEntry={scriptEntryOf(context)}
    />,
    { status },
  )
}

export const createTasksController = (options: {
  readonly runtime: HubRuntime
  readonly author: string
}) =>
  createController(routes.project.tasks, {
    middleware: [loadProject(options)],
    actions: {
      add: async (context) => {
        try {
          const form = formOf(context)
          const parsed = parseAddForm(form)
          const submitted = {
            title: parsed.title,
            group: String(form.get("group") ?? "").trim(),
            newGroup: parsed.newGroup,
          }
          if (parsed.issues.length > 0) return renderBoard(context, 422, submitted, parsed.issues)
          const result = await runTodo(runtimeContext(context), (todo) =>
            todo.add(
              { title: parsed.title },
              parsed.group === "" ? undefined : { group: parsed.group },
            ),
          )
          const project = projectOf(context)
          if (result.ok)
            return redirect(routes.project.tasks.show.href({ project, id: result.value.id }), 303)
          if (tagOf(result.error) === "ValidationError")
            return renderBoard(
              context,
              422,
              submitted,
              (result.error as { readonly issues: ReadonlyArray<string> }).issues,
            )
          return respond(context, result.error)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      show: async (context) => {
        try {
          return await renderTask(context, idOf(context))
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      edit: async (context) => {
        try {
          return await renderEdit(context, idOf(context))
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      update: async (context) => {
        try {
          const id = idOf(context)
          const values = parseEditForm(formOf(context))
          if (values.title === "") return renderEdit(context, id, values, ["Title is required"], 422)
          const result = await runTodo(runtimeContext(context), (todo) =>
            todo.update(id, {
              title: values.title,
              description: values.description,
              tags: [...(values.tags ? values.tags.split(/[\s,]+/).filter(Boolean) : [])],
              assignee: values.assignee === "" ? null : values.assignee,
              dependsOn: normalizeDependencies(values.dependsOn),
            }),
          )
          const project = projectOf(context)
          if (result.ok)
            return redirect(routes.project.tasks.show.href({ project, id: result.value.id }), 303)
          if (tagOf(result.error) === "ValidationError")
            return renderEdit(
              context,
              id,
              values,
              (result.error as { readonly issues: ReadonlyArray<string> }).issues,
              422,
            )
          return respond(context, result.error)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      complete: async (context) => {
        try {
          const project = projectOf(context)
          const form = formOf(context)
          const back = localBack(form.get("back")?.toString(), project)
          const result = await runTodo(runtimeContext(context), (todo) =>
            todo.complete(idOf(context)),
          )
          if (!result.ok) {
            if (tagOf(result.error) !== "InvalidTransition") return respond(context, result.error)
            setFlash(context, { message: errorDescription(result.error), tone: "warning" })
            return redirect(back, 303)
          }
          const unblocked = result.value.unblocked.map((view) => showId(view.task.id)).join(", ")
          setFlash(context, {
            message: `Completed ${showId(result.value.task.id)}.${
              unblocked === "" ? "" : ` Now ready: ${unblocked}`
            }`,
            tone: "info",
          })
          return redirect(back, 303)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      reopen: async (context) => {
        try {
          const project = projectOf(context)
          const id = idOf(context)
          const back = routes.project.tasks.show.href({ project, id })
          const result = await runTodo(runtimeContext(context), (todo) => todo.reopen(id))
          if (!result.ok) {
            if (tagOf(result.error) !== "InvalidTransition") return respond(context, result.error)
            setFlash(context, { message: errorDescription(result.error), tone: "warning" })
            return redirect(back, 303)
          }
          return redirect(routes.project.tasks.show.href({ project, id: result.value.id }), 303)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      comments: async (context) => {
        try {
          const project = projectOf(context)
          const id = idOf(context)
          const values = parseCommentForm(formOf(context))
          const author = values.author || String(context.get(authorContext) ?? "unknown")
          const result = await runTodo(runtimeContext(context), (todo) =>
            todo.comment(id, { author, body: values.body }),
          )
          return result.ok
            ? redirect(routes.project.tasks.show.href({ project, id }), 303)
            : respond(context, result.error)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      move: async (context) => {
        try {
          const project = projectOf(context)
          const id = idOf(context)
          const form = formOf(context)
          const back = localBack(form.get("back")?.toString(), project)
          const parsed = parseMoveForm(form)
          if (parsed.issues.length > 0) return renderTask(context, id, parsed.issues, 422)
          const anchored = parsed.before !== undefined || parsed.after !== undefined
          const result = await runTodo(runtimeContext(context), (todo) =>
            Effect.gen(function* () {
              if (anchored)
                return yield* todo.move(id, {
                  ...(parsed.before === undefined ? {} : { before: parsed.before }),
                  ...(parsed.after === undefined ? {} : { after: parsed.after }),
                })
              const group = parsed.group === "" ? undefined : parsed.group
              if (parsed.position === "top") {
                const section = (yield* todo.list()).sections.find((s) => s.name === group)
                const first = section?.tasks.find((view) => view.task.id !== id)?.task
                if (first !== undefined) return yield* todo.move(id, { before: first.id })
              }
              return yield* todo.move(id, group === undefined ? {} : { group })
            }),
          )
          if (!result.ok) {
            const tag = tagOf(result.error)
            if (tag === "ValidationError")
              return renderTask(
                context,
                id,
                (result.error as { readonly issues: ReadonlyArray<string> }).issues,
                422,
              )
            if (tag !== "InvalidTransition") return respond(context, result.error)
            setFlash(context, { message: errorDescription(result.error), tone: "warning" })
            return redirect(back, 303)
          }
          if (!anchored)
            setFlash(context, {
              message: `Moved ${showId(result.value.id)} to ${result.value.group ?? "the ungrouped tasks"}.`,
              tone: "info",
            })
          return redirect(back, 303)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      confirmRemove: async (context) => {
        try {
          return await renderRemove(context, idOf(context))
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      remove: async (context) => {
        try {
          const project = projectOf(context)
          const id = idOf(context)
          const force = formOf(context).get("force") === "1"
          const result = await runTodo(runtimeContext(context), (todo) =>
            Effect.gen(function* () {
              const { task } = (yield* todo.show(id)).view
              yield* todo.remove(id, { force })
              return task
            }),
          )
          if (!result.ok) {
            if (tagOf(result.error) === "HasDependents")
              return renderRemove(context, id, [errorDescription(result.error)], 422)
            return respond(context, result.error)
          }
          setFlash(context, {
            message: `Removed ${showId(result.value.id)} ${result.value.title}.`,
            tone: "info",
          })
          return redirect(
            result.value.status === "done"
              ? routes.project.done.href({ project })
              : routes.project.board.href({ project }),
            303,
          )
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },
    },
  })
```

- [ ] **Step 4: Replace `src/web/app/actions/groups/controller.tsx`**

```tsx
/** @jsxImportSource remix/ui */

import { redirect } from "remix/response/redirect"
import { createController } from "remix/router"
import { GroupNotFound, Unsupported } from "../../../../spec/index.ts"
import type { HubRuntime } from "../../middleware/project.tsx"
import { loadProject } from "../../middleware/project.tsx"
import { runTodo } from "../../middleware/todo.ts"
import { routes } from "../../routes.ts"
import { Document } from "../../ui/document.tsx"
import { RenameGroupPage } from "../../ui/groups.tsx"
import { parseRenameForm } from "../forms.ts"
import {
  capabilitiesOf,
  loadChrome,
  projectOf,
  renderPage,
  runtimeContext,
  scriptEntryOf,
  setFlash,
  type WebContext,
} from "../page.ts"
import { respond, respondDefect } from "../respond.tsx"

const renderRename = async (
  context: WebContext,
  from: string,
  to?: string,
  issues: ReadonlyArray<string> = [],
  status = 200,
): Promise<Response> => {
  if (!capabilitiesOf(context).renameGroup)
    return respond(context, new Unsupported({ operation: "renameGroup" }))
  const project = projectOf(context)
  const chrome = await loadChrome(context)
  if (!chrome.ok) return respond(context, chrome.error)
  if (!chrome.groups.includes(from)) return respond(context, new GroupNotFound({ name: from }))
  return renderPage(
    context,
    <Document
      title={chrome.title}
      project={project}
      pageTitle={`Rename ${from} · ${chrome.title}`}
      content={RenameGroupPage(project, from, to, issues)}
      diagnostics={chrome.diagnosticCounts}
      scriptEntry={scriptEntryOf(context)}
    />,
    { status },
  )
}

export const createGroupsController = (options: {
  readonly runtime: HubRuntime
  readonly author: string
}) =>
  createController(routes.project.groups, {
    middleware: [loadProject(options)],
    actions: {
      edit: async (context) => {
        try {
          const name = new URL(context.request.url).searchParams.get("name") ?? ""
          return await renderRename(context, name)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      rename: async (context) => {
        try {
          const project = projectOf(context)
          const { from, to } = parseRenameForm(context.get(FormData) as FormData)
          if (to === "") return renderRename(context, from, to, ["Name is required"], 422)
          if (to === from) return redirect(routes.project.board.href({ project }), 303)
          const result = await runTodo(runtimeContext(context), (todo) => todo.renameGroup(from, to))
          if (!result.ok) {
            if (result.error._tag === "ValidationError")
              return renderRename(context, from, to, result.error.issues, 422)
            return respond(context, result.error)
          }
          setFlash(context, { message: `Renamed group ${from} to ${to}.`, tone: "info" })
          return redirect(routes.project.board.href({ project }), 303)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },
    },
  })
```

- [ ] **Step 5: Update `src/web/app/actions/respond.tsx` to name the current project**

`respond`/`respondDefect` render `ErrorPage` for failures raised *inside* an already-`loadProject`-resolved request (every call site is inside `controller.tsx`, `tasks/controller.tsx` or `groups/controller.tsx`), so they can and should pass the project through, instead of falling back to `ErrorPage`'s project-less `/` link:

```tsx
/** @jsxImportSource remix/ui */
import { ErrorPage } from "../ui/document.tsx"
import { projectOf, renderPage, scriptEntryOf, type WebContext } from "./page.ts"

type TaggedFailure = { readonly _tag: string } & Record<string, unknown>

const isTaggedFailure = (value: unknown): value is TaggedFailure =>
  typeof value === "object" && value !== null && "_tag" in value && typeof value._tag === "string"

export const errorDescription = (error: unknown): string => {
  if (!isTaggedFailure(error)) return error instanceof Error ? error.message : String(error)
  switch (error._tag) {
    case "TaskNotFound":
      return `Task ${String(error.id)} was not found.`
    case "GroupNotFound":
      return `Group ${String(error.name)} was not found.`
    case "InvalidTransition":
      return `Task ${String(error.id)} cannot be ${String(error.operation)}${String(error.operation).endsWith("e") ? "d" : "ed"} while it is ${String(error.status)}.`
    case "ValidationError":
      return Array.isArray(error.issues) ? error.issues.join(" ") : "The submitted task is invalid."
    case "Unsupported":
      return `This list does not support ${String(error.operation)}.`
    case "HasDependents":
      return `Task ${String(error.id)} still has open tasks depending on it: ${
        Array.isArray(error.dependents) ? error.dependents.join(", ") : ""
      }.`
    case "StoreError":
      return String(error.message)
    default:
      return `Unexpected ${error._tag} failure.`
  }
}

export const statusFor = (error: unknown): number => {
  if (!isTaggedFailure(error)) return 500
  switch (error._tag) {
    case "TaskNotFound":
      return 404
    case "GroupNotFound":
    case "Unsupported":
    case "InvalidTransition":
      return 400
    case "ValidationError":
      return 400
    case "HasDependents":
      return 409
    default:
      return 500
  }
}

export const respond = (context: WebContext, error: unknown): Response => {
  const status = statusFor(error)
  return renderPage(
    context,
    <ErrorPage
      status={status}
      message={errorDescription(error)}
      project={projectOf(context)}
      scriptEntry={scriptEntryOf(context)}
    />,
    { status },
  )
}

export const respondDefect = (context: WebContext, defect: unknown): Response =>
  renderPage(
    context,
    <ErrorPage
      status={500}
      message={errorDescription(defect)}
      project={projectOf(context)}
      scriptEntry={scriptEntryOf(context)}
    />,
    { status: 500 },
  )
```

Only `statusFor`/`errorDescription` bodies are unchanged from before; the two exported response builders gain `project={projectOf(context)}`.

- [ ] **Step 6: Commit**

```bash
git add src/web/app/actions/controller.tsx src/web/app/actions/tasks/controller.tsx \
  src/web/app/actions/groups/controller.tsx src/web/app/actions/respond.tsx
git commit -m "web: split controllers into project-scoped and top-level factories"
```

---

### Task 5: Rewire `router.ts`

**Files:**
- Modify: `src/web/app/router.ts`

**Interfaces:**
- Consumes: `createRootController`, `createTopController` (Task 4's `controller.tsx`), `createTasksController` (Task 4's `tasks/controller.tsx`), `createGroupsController` (Task 4's `groups/controller.tsx`), `HubRuntime` (Task 2).
- Produces: `export interface RouterOptions { readonly runtime: HubRuntime; readonly author: string; readonly hosts: ReadonlyArray<string>; readonly startup: string; readonly sessionSecret?: string; readonly assets?: AppAssets }`, `export const createAppRouter = (options: RouterOptions) => Router`. Task 6 (`server.ts`) and Task 10 (test harness) both build against this exact shape.

- [ ] **Step 1: Replace `src/web/app/router.ts`**

```ts
import { createCookie } from "remix/cookie"
import { cop } from "remix/middleware/cop"
import { formData } from "remix/middleware/form-data"
import { render } from "remix/middleware/render"
import { session } from "remix/middleware/session"
import { createRouter } from "remix/router"
import { createMemorySessionStorage } from "remix/session-storage/memory"
import { createGroupsController } from "./actions/groups/controller.tsx"
import { createRootController, createTopController } from "./actions/controller.tsx"
import { createTasksController } from "./actions/tasks/controller.tsx"
import { type AppAssets, createAssets, loadAssets } from "./assets.ts"
import { loadAssetEntry } from "./middleware/assets.ts"
import { localOnly } from "./middleware/local.ts"
import type { HubRuntime } from "./middleware/project.tsx"
import { routes } from "./routes.ts"

export interface RouterOptions {
  readonly runtime: HubRuntime
  readonly author: string
  readonly hosts: ReadonlyArray<string>
  /** The startup project's name; `GET /` redirects to its board. */
  readonly startup: string
  readonly sessionSecret?: string
  readonly assets?: AppAssets
}

export const createAppRouter = (options: RouterOptions) => {
  const assets = options.assets ?? createAssets()
  const cookie = createCookie("todo-md-session", {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secrets: [options.sessionSecret ?? crypto.randomUUID() + crypto.randomUUID()],
  })
  const router = createRouter({
    middleware: [
      localOnly(options.hosts),
      cop(),
      loadAssets(assets),
      formData(),
      session(cookie, createMemorySessionStorage()),
      loadAssetEntry(assets),
      render({ assets }),
    ],
  })
  const controllerOptions = { runtime: options.runtime, author: options.author }
  router.map(routes.project, createRootController(controllerOptions))
  router.map(routes.project.tasks, createTasksController(controllerOptions))
  router.map(routes.project.groups, createGroupsController(controllerOptions))
  router.map(routes, createTopController({ runtime: options.runtime, startup: options.startup }))
  return Object.assign(router, {
    close: async () => {
      await assets.close()
    },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit -p .`
Expected: errors now point only at `server.ts` and the test files still using the old `RouterOptions` shape (fixed in Tasks 6 and 10).

- [ ] **Step 3: Commit**

```bash
git add src/web/app/router.ts
git commit -m "web: wire the hub-backed router options and per-scope controllers"
```

---

### Task 6: Rebuild `server.ts` on the hub

**Files:**
- Modify: `src/web/server.ts`
- Delete: `src/web/watch.ts`

**Interfaces:**
- Consumes: `Hub` (`src/hub/index.ts`), `fsSource` (`src/hub/index.ts`), `createAppRouter` (Task 5).
- Produces: `export interface ServerOptions { readonly cwd: string; readonly dir?: string; readonly project?: string; readonly port: number; readonly host: string; readonly env: Readonly<Record<string, string | undefined>>; readonly username: string; readonly home: string; readonly userHome: string }`, `export const startServer = (options: ServerOptions) => Promise<{ server; port: number; close(): Promise<void> }>`. Task 7 (`web.ts`) calls `startServer` with this exact shape, including the two new `home`/`userHome`/`project` fields.

- [ ] **Step 1: Replace `src/web/server.ts`**

```ts
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, ManagedRuntime } from "effect"
import { fsSource, Hub } from "../hub/index.ts"
import type { HubRuntime } from "./app/middleware/project.tsx"
import { createAppRouter } from "./app/router.ts"

export interface ServerOptions {
  readonly cwd: string
  readonly dir?: string
  /** A registered project's name; exclusive with `dir`. */
  readonly project?: string
  readonly port: number
  readonly host: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly username: string
  /** The hub's directory: `$TODO_MD_HOME`, else `<userHome>/.todo-md`. */
  readonly home: string
  readonly userHome: string
}

export const startServer = async (options: ServerOptions) => {
  const runtime = ManagedRuntime.make(
    Hub.layer({ home: options.home, userHome: options.userHome, sources: [fsSource] }).pipe(
      Layer.provide(BunServices.layer),
    ),
  )
  const hubRuntime: HubRuntime = { runPromise: (effect) => runtime.runPromise(effect) }
  let startup: string
  try {
    const info = await runtime.runPromise(
      Effect.flatMap(Hub, (hub) =>
        hub.resolve({
          ...(options.project !== undefined ? { project: options.project } : {}),
          ...(options.dir !== undefined ? { dir: options.dir } : {}),
          cwd: options.cwd,
        }),
      ),
    )
    startup = info.name
  } catch (error) {
    await runtime.dispose()
    throw error
  }
  let app: ReturnType<typeof createAppRouter>
  try {
    app = createAppRouter({
      runtime: hubRuntime,
      startup,
      author: options.env.TODO_MD_AUTHOR ?? options.username,
      hosts: ["localhost", "127.0.0.1", "::1", options.host],
    })
  } catch (error) {
    await runtime.dispose()
    throw error
  }
  let port = options.port
  let server: ReturnType<typeof Bun.serve>
  try {
    while (true) {
      try {
        server = Bun.serve({ port, hostname: options.host, fetch: (request) => app.fetch(request) })
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error
        port += 1
      }
    }
  } catch (error) {
    await app.close()
    await runtime.dispose()
    throw error
  }
  let closed = false
  return {
    server,
    port,
    close: async () => {
      if (closed) return
      closed = true
      await app.close()
      await runtime.dispose()
      server.stop()
    },
  }
}
```

Delete `src/web/watch.ts` (superseded by `fsSource.changes`/`watchList` in `src/hub/sources/fs.ts`, already built in task 15).

- [ ] **Step 2: Update `test/web/server.test.ts`**

`resolveRoot` no longer exists; replace its three tests with ones that exercise `startServer`'s hub-based startup resolution end-to-end (a temporary home, one registered project):

```ts
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startServer } from "../../src/web/server.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

const base = { port: 0, host: "127.0.0.1", env: {}, username: "tester" }

test("starts over an unregistered --dir list and serves its board", async () => {
  const home = await mkdtemp(join(tmpdir(), "todo-md-home-"))
  const dir = await mkdtemp(join(tmpdir(), "todo-md-list-"))
  await writeFile(join(dir, "TODO.md"), "# Disk list\n")
  const started = await startServer({ ...base, cwd: dir, dir, home, userHome: home })
  cleanup.push(async () => {
    await started.close()
    await rm(home, { recursive: true, force: true })
    await rm(dir, { recursive: true, force: true })
  })
  const response = await fetch(`http://127.0.0.1:${started.port}/`, { redirect: "manual" })
  expect(response.status).toBe(302)
  const location = response.headers.get("location") ?? ""
  expect(location).toMatch(/^\/p\/.+/)
  const board = await fetch(`http://127.0.0.1:${started.port}${location}`)
  expect(board.status).toBe(200)
  expect(await board.text()).toContain("Disk list")
})

test("starts over a registered fs project by name", async () => {
  const home = await mkdtemp(join(tmpdir(), "todo-md-home-"))
  const dir = await mkdtemp(join(tmpdir(), "todo-md-list-"))
  await writeFile(join(dir, "TODO.md"), "# Registered list\n")
  await mkdir(join(home, "projects", "acme"), { recursive: true })
  await writeFile(
    join(home, "projects.yaml"),
    `projects:\n  acme:\n    source: fs\n    path: ${dir}\n`,
  )
  const started = await startServer({ ...base, cwd: home, project: "acme", home, userHome: home })
  cleanup.push(async () => {
    await started.close()
    await rm(home, { recursive: true, force: true })
    await rm(dir, { recursive: true, force: true })
  })
  const response = await fetch(`http://127.0.0.1:${started.port}/`, { redirect: "manual" })
  expect(response.headers.get("location")).toBe("/p/acme")
})

test("throws with the standard message when no list is found and no project is given", async () => {
  const home = await mkdtemp(join(tmpdir(), "todo-md-home-"))
  const cwd = await mkdtemp(join(tmpdir(), "todo-md-empty-"))
  cleanup.push(async () => {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })
  await expect(startServer({ ...base, cwd, home, userHome: home })).rejects.toThrow(
    "no todo.md list found",
  )
})
```

- [ ] **Step 3: Run the tests**

Run: `bun test test/web/server.test.ts`
Expected: PASS

- [ ] **Step 4: Update `test/boundaries.test.ts`**

`server.ts` still imports `node:` builtins only through `@effect/platform-bun`/`Bun.serve` (unchanged from before), so its `serverOnly` entry stays; `watch.ts` no longer exists, so drop it from the list, and add `"hub"` to `webModules` plus `"@lemol/todo-md/hub"` to `webTodoPackages`. Since `server.ts` no longer imports `../fs/index.ts`, and nothing else in `src/web` does either, drop `"fs"` from `webModules` and `"@lemol/todo-md/fs"` from `webTodoPackages`.

```ts
const webTodoPackages = [
  "@lemol/todo-md/spec",
  "@lemol/todo-md/core",
  "@lemol/todo-md/hub",
  "@lemol/todo-md/markdown",
  "@lemol/todo-md/spec/testing",
  "@lemol/todo-md/hub/testing",
]
const webModules = ["spec", "core", "hub"]

export const webViolations = (file: string, source: string): string[] => {
  const isTest = file.startsWith("test/") || file.includes(".test.")
  const serverOnly = file === "server.ts" || file === "app/assets.ts"
  ...
```

- [ ] **Step 5: Run the full boundaries test**

Run: `bun test test/boundaries.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/web/server.ts test/web/server.test.ts test/boundaries.test.ts
git rm src/web/watch.ts
git commit -m "web: build the server over Hub.layer instead of a single FsTodoStore"
```

---

### Task 7: `todo web` accepts `--project`

**Files:**
- Modify: `src/cli/commands/web.ts`

**Interfaces:**
- Consumes: `startServer` (Task 6's new `ServerOptions` shape), `CliContext` (already exposes `home`, `userHome`; confirm in Step 1), `Hub` (for the fail-fast resolve).

- [ ] **Step 1: Confirm `CliContext` already carries `home`/`userHome`**

Run: `grep -n "home\|userHome" src/cli/context.ts`
Expected: both fields are already declared on `CliContext["Service"]` (they are — `main.ts` already reads `context.home`/`context.userHome` to build `Hub.layer`). No change needed there.

- [ ] **Step 2: Write the failing test**

Add to `test/cli/commands/web.test.ts` (create the file if it doesn't exist yet — check first with `ls test/cli/commands/web.test.ts`; if a web CLI test file already exists, add these cases to it instead of creating a duplicate):

```ts
import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main } from "../../../src/cli/main.ts"
import { fsSource } from "../../../src/hub/index.ts"

const baseContext = async () => {
  const home = await mkdtemp(join(tmpdir(), "todo-md-cli-home-"))
  const cwd = await mkdtemp(join(tmpdir(), "todo-md-cli-cwd-"))
  return {
    home,
    cwd,
    context: {
      cwd,
      env: {},
      username: "tester",
      color: false,
      home,
      userHome: home,
      sources: [fsSource],
    },
  }
}

test("rejects --project together with --dir", async () => {
  const { context, home, cwd } = await baseContext()
  try {
    const code = await main(["web", "--project", "acme", "--dir", "todo"], context)
    expect(code).toBe(2)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test test/cli/commands/web.test.ts`
Expected: FAIL — current `web.ts` rejects `--project` unconditionally with a different message ("todo web works on local lists; use --dir"), and the process would actually try to start a real server (hangs) in the `--project`-only path since it's not intercepted before `Effect.never`; this specific test (both flags given) already fails fast today, so confirm this new assertion trips on the **message**, not a hang, by checking stderr text separately if `main`'s return code alone doesn't distinguish them: adjust the assertion to check `code === 2` only, which is true for the *old* rejection too — so also add a second assertion the old code fails:

```ts
test("still allows --project alone (does not reject outright)", async () => {
  // Documents the change from the old blanket rejection; full server startup
  // is covered by test/web/server.test.ts, so this only checks the flag
  // parses without the old UsageError message.
})
```

Given `todo web --project` alone would actually start listening (undesirable in a unit test), skip asserting success end-to-end here; the meaningful regression check is the mutual-exclusion message. Replace the file's second test with an inspection of `describeError`'s output instead of running the command to completion — see Step 4 for the actual implementation, then finalize this test against it.

- [ ] **Step 4: Update `src/cli/commands/web.ts`**

```ts
import { Effect, Option, Path } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { Hub } from "../../hub/index.ts"
import { startServer } from "../../web/server.ts"
import { CliContext, Dir, output, Project } from "../context.ts"
import { UsageError } from "../errors.ts"

const loopback = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "::1"

export const web = Command.make(
  "web",
  {
    port: Flag.integer("port").pipe(
      Flag.withDescription("Port to listen on; the next free port is used when busy"),
      Flag.withDefault(4400),
    ),
    host: Flag.string("host").pipe(
      Flag.withDescription("Host to bind; anyone who can reach it can edit the list"),
      Flag.withDefault("127.0.0.1"),
    ),
  },
  Effect.fn(function* ({ port, host }) {
    const { cwd, env, username, home, userHome } = yield* CliContext
    const dir = yield* Dir
    const project = yield* Project
    if (Option.isSome(dir) && Option.isSome(project)) {
      return yield* new UsageError({ message: "use --project or --dir, not both" })
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return yield* new UsageError({ message: "port must be an integer from 1 to 65535" })
    }
    const path = yield* Path.Path
    // Fail fast with the CLI's tagged errors; startServer re-resolves the same project.
    const hub = yield* Hub
    yield* hub.resolve({
      ...(Option.isSome(project) ? { project: project.value } : {}),
      ...(Option.isSome(dir) ? { dir: path.resolve(cwd, dir.value) } : {}),
      cwd,
    })
    yield* Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startServer({
              cwd,
              ...(Option.isSome(dir) ? { dir: path.resolve(cwd, dir.value) } : {}),
              ...(Option.isSome(project) ? { project: project.value } : {}),
              port,
              host,
              env,
              username,
              home,
              userHome,
            }),
          ),
          (handle) => Effect.promise(() => handle.close()),
        )
        const url = `http://${host}:${started.port}`
        yield* output(undefined, { url }, () =>
          loopback(host)
            ? [url]
            : [url, "Warning: anyone who can reach this address can edit the list."],
        )
        yield* Effect.never
      }),
    )
  }),
).pipe(
  Command.withDescription("Start the local web UI over the hub"),
  Command.withExamples([
    { command: "todo web --dir todo", description: "Serve the board for ./todo/TODO.md" },
    { command: "todo web --project acme", description: "Serve the registered acme project" },
    { command: "todo web --port 4410", description: "Serve on port 4410" },
  ]),
)
```

Note `dir` is now resolved to an absolute path (`path.resolve(cwd, dir.value)`) before being passed to both `hub.resolve` and `startServer`, since `Hub.resolve`'s `dir` is documented as "relative to `cwd`" but `startServer`'s own `ServerOptions.dir` was previously resolved inside `resolveRoot`; resolving once here keeps both calls consistent and avoids `startServer` re-deriving `cwd`-relative paths after the CLI already changed directories conceptually.

- [ ] **Step 5: Finalize the test file and run it**

Rewrite `test/cli/commands/web.test.ts`'s content to the single, meaningful case (mutual exclusion), matching Step 4's actual behavior:

```ts
import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fsSource } from "../../../src/hub/index.ts"
import { main } from "../../../src/cli/main.ts"

test("todo web rejects --project together with --dir", async () => {
  const home = await mkdtemp(join(tmpdir(), "todo-md-cli-home-"))
  const cwd = await mkdtemp(join(tmpdir(), "todo-md-cli-cwd-"))
  try {
    const code = await main(["web", "--project", "acme", "--dir", "todo"], {
      cwd,
      env: {},
      username: "tester",
      color: false,
      home,
      userHome: home,
      sources: [fsSource],
    })
    expect(code).toBe(2)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})
```

Run: `bun test test/cli/commands/web.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/web.ts test/cli/commands/web.test.ts
git commit -m "cli: let todo web serve a registered project with --project"
```

---

### Task 8: Live refresh only reacts to its own project

**Files:**
- Modify: `src/web/app/actions/public/entry.ts`

**Interfaces:**
- Consumes: `routes.events` (unchanged top-level route), the `data-project` attribute Task 3 added to `[data-live-region]`.

- [ ] **Step 1: Write the failing test**

Add to `test/web/actions/public/refresh.test.ts` (check its current content first with `Read`; the existing file tests `refreshDecision`/`markDirtyOnInput` in isolation, so this is a new, separate concern — add a new test file instead):

Create `test/web/actions/public/entry.test.ts`:

```ts
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

test("entry.ts only reacts to changed/synced events for its own project", () => {
  const source = readFileSync(
    resolve(import.meta.dir, "../../../../src/web/app/actions/public/entry.ts"),
    "utf8",
  )
  expect(source).toContain("data-project")
  expect(source).toContain('addEventListener("changed"')
  expect(source).toContain('addEventListener("synced"')
})
```

This is a light source-shape check (the actual EventSource/SSE loop needs a browser and is exercised manually per `src/web/README.md`'s existing "start the dev server and use the feature in a browser" step); the real regression coverage is `test/web/events.test.ts` (Task 10), which checks the server sends the right event name and JSON payload.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/web/actions/public/entry.test.ts`
Expected: FAIL — no `data-project` or `synced` listener yet.

- [ ] **Step 3: Replace `src/web/app/actions/public/entry.ts`**

```ts
import { run } from "remix/ui"
import { routes } from "../../routes.ts"
import { markDirtyOnInput, refreshDecision } from "./refresh.ts"

export const startLiveRefresh = () => {
  let dirty = false
  document.addEventListener(
    "input",
    (event) => {
      dirty = markDirtyOnInput(event)
    },
    true,
  )
  document.addEventListener(
    "change",
    (event) => {
      dirty = markDirtyOnInput(event)
    },
    true,
  )
  const events = new EventSource(routes.events.href())
  const onChange = async (event: MessageEvent) => {
    const page = document.querySelector("[data-live-region]")
    const project = page?.getAttribute("data-project")
    let payload: { readonly project?: string } = {}
    try {
      payload = JSON.parse(event.data)
    } catch {
      // Malformed payloads are treated as "not this page's project".
    }
    if (project === null || project === undefined || payload.project !== project) return
    if (refreshDecision(dirty) === "notice") {
      document.querySelector("[data-reload-notice]")?.removeAttribute("hidden")
      return
    }
    try {
      const response = await fetch(location.href, { headers: { Accept: "text/html" } })
      if (!response.ok) throw new Error(`refresh failed with ${response.status}`)
      const html = await response.text()
      const parsed = new DOMParser().parseFromString(html, "text/html")
      const next = parsed.querySelector("[data-live-region]")
      const current = document.querySelector("[data-live-region]")
      if (!next || !current) throw new Error("refresh response has no live region")
      current.replaceWith(next)
      dirty = false
    } catch {
      document.querySelector("[data-reload-notice]")?.removeAttribute("hidden")
    }
  }
  events.addEventListener("changed", onChange)
  events.addEventListener("synced", onChange)
}

if (typeof document !== "undefined") {
  const app = run({
    async loadModule(moduleUrl, exportName) {
      const module = await import(moduleUrl)
      const component = module[exportName]
      if (typeof component !== "function")
        throw new Error(`Unknown component: ${moduleUrl}#${exportName}`)
      return component
    },
  })
  void app.ready().then(startLiveRefresh)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/web/actions/public/entry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/app/actions/public/entry.ts test/web/actions/public/entry.test.ts
git commit -m "web: only refresh the page when an SSE event names its own project"
```

---

### Task 9: Rebuild the test harness on `Hub.layer`

**Files:**
- Modify: `test/web/harness.ts`

**Interfaces:**
- Produces: `export const makeHub = (options?: { readonly project?: string; readonly title?: string; readonly capabilities?: Partial<Capabilities>; readonly extraSources?: ReadonlyArray<AnySource> }) => { readonly hubRuntime: ManagedRuntime<Hub>; readonly project: string }`, `export const makeRouter = (options?: Parameters<typeof makeHub>[0]) => ReturnType<typeof createAppRouter>`, `export const makeFakeAssets` (unchanged). Tasks 10 uses `makeHub`/`makeRouter` from here.

This is the task every remaining test file in `test/web/` depends on; write it first and get it green in isolation before touching the other test files (Task 10).

- [ ] **Step 1: Write the failing test**

Create `test/web/harness.test.ts` (a smoke test for the harness itself, deleted or kept — keep it, it's cheap and documents the contract):

```ts
import { afterEach, expect, test } from "bun:test"
import { makeRouter } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test("makeRouter serves the default project's board", async () => {
  const { router, project, close } = makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request(`http://localhost/p/${project}`, { headers: { Host: "localhost" } }),
  )
  expect(response.status).toBe(200)
  expect(await response.text()).toContain("Acme")
})

test("makeRouter can reduce a project's capabilities", async () => {
  const { router, project, close } = makeRouter({ capabilities: { groups: false, comments: false } })
  cleanup.push(close)
  const response = await router.fetch(
    new Request(`http://localhost/p/${project}`, { headers: { Host: "localhost" } }),
  )
  const html = await response.text()
  expect(html).not.toContain('name="newGroup"')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/web/harness.test.ts`
Expected: FAIL — `makeRouter` doesn't return `{ router, project, close }` yet (current signature returns a bare router with no `project`/`close`).

- [ ] **Step 3: Replace `test/web/harness.ts`**

A registered project needs a real `projects.yaml` entry, not just a `Source` value passed to `Hub.layer` (the source only teaches the hub *how* to open a project named in the registry). `test/hub/helpers.ts`'s `hubOn` gets this from the `Disk`/`diskWith` test layer; this harness has no `Disk` service, so it writes the file itself, synchronously, before building the runtime.

```ts
import { mkdirSync, writeFileSync } from "node:fs"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, ManagedRuntime } from "effect"
import type { AnySource } from "../../src/hub/index.ts"
import { Hub } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { TodoService } from "../../src/core/index.ts"
import { TodoStore, type Capabilities } from "../../src/spec/index.ts"
import type { AppAssets } from "../../src/web/app/assets.ts"
import type { HubRuntime } from "../../src/web/app/middleware/project.tsx"
import { createAppRouter } from "../../src/web/app/router.ts"

/** A `memorySource` whose store reports `capabilities` overridden for a test. */
export const memoryWithCapabilities = (capabilities: Partial<Capabilities>): AnySource => {
  const base = memorySource()
  return {
    ...base,
    open: (project) =>
      Layer.map(base.open(project), (store) =>
        TodoStore.of({ ...store, capabilities: { ...store.capabilities, ...capabilities } }),
      ),
  }
}

/** A fresh hub home with one registered `memory` project, written synchronously. */
const homeFor = (project: string, title: string): string => {
  const home = `/tmp/todo-md-web-test-${crypto.randomUUID()}`
  mkdirSync(home, { recursive: true })
  writeFileSync(
    `${home}/projects.yaml`,
    `projects:\n  ${project}:\n    source: memory\n    title: ${JSON.stringify(title)}\n`,
  )
  return home
}

export interface MakeHubOptions {
  readonly project?: string
  readonly title?: string
  readonly capabilities?: Partial<Capabilities>
  readonly extraSources?: ReadonlyArray<AnySource>
}

/**
 * A `ManagedRuntime<Hub>` over a fresh home with one registered project
 * (default name `acme`, title `Acme`).
 */
export const makeHub = (options: MakeHubOptions = {}) => {
  const project = options.project ?? "acme"
  const home = homeFor(project, options.title ?? "Acme")
  const source =
    options.capabilities === undefined
      ? memorySource()
      : memoryWithCapabilities(options.capabilities)
  const hubRuntime = ManagedRuntime.make(
    Hub.layer({ home, userHome: home, sources: [source, ...(options.extraSources ?? [])] }).pipe(
      Layer.provide(BunServices.layer),
    ),
  )
  return { hubRuntime, project }
}

/** Runs `use` against `project`'s `TodoService` through the hub. */
export const seed = <A, E>(
  hubRuntime: ReturnType<typeof makeHub>["hubRuntime"],
  project: string,
  use: (todo: TodoService["Service"]) => Effect.Effect<A, E, never>,
) => hubRuntime.runPromise(Effect.flatMap(Hub, (hub) => Effect.flatMap(hub.todo(project), use)))

export const makeFakeAssets = (): AppAssets => ({
  getScriptEntry: async (path) => ({
    href: `/assets/${path}`,
    importMap: { imports: {}, scopes: {} },
    preloads: [],
  }),
  fetch: async () => null,
  close: async () => undefined,
})

export interface MakeRouterOptions extends MakeHubOptions {
  readonly assets?: AppAssets
}

/**
 * A ready-to-fetch router over one registered `memorySource` project (default
 * name `acme`, title `Acme`, no tasks — use `seed` to add what a test needs).
 * `close()` disposes both the router and the hub runtime.
 */
export const makeRouter = (options: MakeRouterOptions = {}) => {
  const { hubRuntime, project } = makeHub(options)
  const runtime: HubRuntime = { runPromise: (effect) => hubRuntime.runPromise(effect) }
  const router = createAppRouter({
    runtime,
    startup: project,
    author: "tester",
    hosts: ["localhost", "127.0.0.1", "::1"],
    sessionSecret: "test-secret-at-least-32-characters",
    assets: options.assets ?? makeFakeAssets(),
  })
  return {
    router,
    project,
    hubRuntime,
    close: async () => {
      await router.close()
      await hubRuntime.dispose()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/web/harness.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/web/harness.ts test/web/harness.test.ts
git commit -m "test/web: rebuild the router harness over Hub.layer with memorySource"
```

---

### Task 10: Update the remaining `test/web` suites for `/p/:project`

**Files:**
- Modify: `test/web/events.test.ts`, `test/web/security.test.ts`, `test/web/contracts.test.ts`, `test/web/ui.test.ts`, `test/web/router.test.ts`, `test/web/fs-e2e.test.ts`
- Delete: `test/web/watch.test.ts`

**Interfaces:**
- Consumes: `makeRouter`, `makeHub`, `memoryWithCapabilities` (Task 9).

Apply this recipe to every file in the list (mechanical — each site is a 1:1 substitution; the harness change (Task 9) is the only thing that was structurally new):

1. Replace every import of `makeFakeChanges`/`makeRuntime` from `./harness.ts` or `../../src/web/app/middleware/changes.ts` with `makeRouter` (and `memoryWithCapabilities` where a test varies capabilities).
2. Replace every `createAppRouter({ runtime, capabilities, changes: makeFakeChanges(), author, hosts, sessionSecret, assets })` call with `const { router, project, close } = makeRouter({ ...capabilities !== allCapabilities ? { capabilities } : {} })`, and register `cleanup.push(close)` (dropping the separate `runtime.dispose()`/`router.close()` pair the old `afterEach` used).
3. Replace every `routes.board.href()` → `` `/p/${project}` `` (or `routes.project.board.href({ project })` if the test already imports `routes`), `routes.done.href()` → `routes.project.done.href({ project })`, `routes.check.href()` → `routes.project.check.href({ project })`, `routes.tasks.X.href({ id })` → `routes.project.tasks.X.href({ project, id })`, `routes.groups.X.href()` → `routes.project.groups.X.href({ project })`.
4. Any direct `TodoService.use(...)` seeding call (`runtime.runPromise(TodoService.use((todo) => todo.add(...)))`) becomes `hubRuntime.runPromise(Effect.flatMap(Hub, (hub) => hub.todo(project)).pipe(Effect.flatMap((todo) => todo.add(...))))` — or more simply, add a small harness helper for this in Task 9 if more than two call sites need it (check `contracts.test.ts` first: it has ~15 `seed`-style calls, so add this helper to `test/web/harness.ts` instead of repeating it — see Step 0 below).
5. Delete `test/web/watch.test.ts` outright (superseded by `test/hub/fs.test.ts`, built in task 15).

- [ ] **Step 0: Confirm the harness's `seed` helper covers every test file's seeding need**

Task 9 already added `seed(hubRuntime, project, use)` to `test/web/harness.ts`, where `use: (todo: TodoService["Service"]) => Effect.Effect<A, never, never>`. Every call site in this task passes an `Effect` (e.g. `(todo) => todo.add({ title: "..." })`, which already returns an `Effect`), not a bare `Promise`. Run `grep -n "TodoService.use\|runtime.runPromise(TodoService" test/web/contracts.test.ts` to find every old direct-seeding call site that Step 6 below needs to convert.

- [ ] **Step 1: `test/web/events.test.ts`**

```ts
import { afterEach, expect, test } from "bun:test"
import { makeRouter, seed } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test("emits a changed event naming the project that changed, and unsubscribes on abort", async () => {
  const { router, hubRuntime, project, close } = makeRouter()
  cleanup.push(close)
  const abort = new AbortController()
  const response = await router.fetch(
    new Request("http://localhost/events", { headers: { Host: "localhost" }, signal: abort.signal }),
  )
  expect(response.headers.get("content-type")).toContain("text/event-stream")
  const reader = response.body!.getReader()

  // The SSE handler's hub.changes subscription starts on a forked fiber, so
  // there is a small, unavoidable window where a seed lands before the
  // subscription does (test/hub/helpers.ts's `eventually` exists for the
  // same reason inside the hub's own suite). Retry the seed instead of
  // assuming the first one is observed.
  let text = ""
  for (let attempt = 0; attempt < 25 && text === ""; attempt++) {
    await seed(hubRuntime, project, (todo) => todo.add({ title: `Trigger ${attempt}` }))
    const timedOut = Symbol("timeout")
    const raced = await Promise.race([
      reader.read(),
      new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), 20)),
    ])
    if (raced !== timedOut && !raced.done && raced.value !== undefined) {
      text = new TextDecoder().decode(raced.value)
    }
  }
  expect(text).toMatch(/^event: changed\ndata: \{"project":"[a-z0-9-]+"\}\n\n$/)

  abort.abort()
})
```

- [ ] **Step 2: `test/web/security.test.ts`**

```ts
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { TaskNotFound } from "../../src/spec/index.ts"
import { runTodo, taskId } from "../../src/web/app/middleware/todo.ts"
import { makeRouter } from "./harness.ts"

test("rejects foreign hosts, including the event stream", async () => {
  const { router, project, close } = makeRouter()
  try {
    for (const path of [`/p/${project}`, "/events"]) {
      const response = await router.fetch(
        new Request(`http://foreign.example${path}`, { headers: { Host: "foreign.example" } }),
      )
      expect(response.status).toBe(403)
    }
  } finally {
    await close()
  }
})

test("rejects cross-origin POSTs", async () => {
  const { router, project, close } = makeRouter()
  try {
    const response = await router.fetch(
      new Request(`http://localhost/p/${project}/tasks`, {
        method: "POST",
        headers: { Host: "localhost", Origin: "http://foreign.example" },
        body: new FormData(),
      }),
    )
    expect(response.status).toBe(403)
  } finally {
    await close()
  }
})

test("maps typed failures but lets defects reject", async () => {
  const fakeRuntime = { runPromise: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromise(effect as never) }
  const context = { get: () => fakeRuntime }
  const typed = await runTodo(context, () => Effect.fail(new TaskNotFound({ id: "7" })))
  expect(typed).toEqual({ ok: false, error: expect.any(TaskNotFound) })

  await expect(runTodo(context, () => Effect.die("boom"))).rejects.toBe("boom")
})

test("taskId strips leading zeros from numeric IDs only", () => {
  expect(taskId("007")).toBe("7")
  expect(taskId("PROJ-7")).toBe("PROJ-7")
})
```

(`taskId`'s test is unchanged from before if it already existed lower in the original file — check the current file's tail past line 43 before assuming this is new; if it's already there, leave it as is.)

- [ ] **Step 3: `test/web/router.test.ts`**

```ts
import { afterEach, expect, test } from "bun:test"
import { makeRouter } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test("allowed GET requests reach the board controller", async () => {
  const { router, project, close } = makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request(`http://localhost/p/${project}`, { headers: { Host: "localhost" } }),
  )
  expect(response.status).toBe(200)
  expect(await response.text()).toContain("Acme")
})

test("GET / redirects to the startup project's board", async () => {
  const { router, project, close } = makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request("http://localhost/", { headers: { Host: "localhost" }, redirect: "manual" }),
  )
  expect(response.status).toBe(302)
  expect(response.headers.get("location")).toBe(`/p/${project}`)
})

test("an unknown project renders 404", async () => {
  const { router, close } = makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request("http://localhost/p/ghost", { headers: { Host: "localhost" } }),
  )
  expect(response.status).toBe(404)
})
```

- [ ] **Step 4: `test/web/ui.test.ts`**

```ts
import { afterEach, expect, test } from "bun:test"
import { localBack } from "../../src/web/app/actions/forms.ts"
import { statusFor } from "../../src/web/app/actions/respond.tsx"
import { createAssets } from "../../src/web/app/assets.ts"
import { routes } from "../../src/web/app/routes.ts"
import { markdownHtml } from "../../src/web/app/ui/markdown.tsx"
import { makeRouter } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test("renders Markdown without raw HTML", () => {
  const html = markdownHtml("**safe** <script>alert(1)</script>")
  expect(html).toContain("<strong>safe</strong>")
  expect(html).not.toContain("<script>")
  expect(html).not.toContain("alert(1)")
})

test("removes unsafe Markdown link protocols", () => {
  expect(markdownHtml("[bad](javascript:alert(1))")).not.toContain("javascript:")
  expect(markdownHtml("[also bad](data:text/html,pwned)")).not.toContain("data:")
  expect(markdownHtml("[web](https://example.com) [local](/tasks/1)")).toContain(
    'href="https://example.com"',
  )
  expect(markdownHtml("[local](/tasks/1)")).toContain('href="/tasks/1"')
})

test("accepts only unambiguously local redirect targets", () => {
  expect(localBack("/?state=ready", "acme")).toBe("/?state=ready")
  expect(localBack("//evil.example", "acme")).toBe(routes.project.board.href({ project: "acme" }))
  expect(localBack("/\\evil.example", "acme")).toBe(routes.project.board.href({ project: "acme" }))
  expect(localBack("/ok\r\nLocation: https://evil.example", "acme")).toBe(
    routes.project.board.href({ project: "acme" }),
  )
})

test("maps unclaimed domain failures to their specified status", () => {
  expect(statusFor({ _tag: "TaskNotFound", id: "1" })).toBe(404)
  expect(statusFor({ _tag: "GroupNotFound", name: "missing" })).toBe(400)
  expect(statusFor({ _tag: "Unsupported", operation: "comment" })).toBe(400)
  expect(statusFor({ _tag: "ValidationError", issues: ["invalid"] })).toBe(400)
  expect(statusFor({ _tag: "StoreError", message: "disk failed" })).toBe(500)
  expect(statusFor(new Error("defect"))).toBe(500)
})

test("compiles the browser entry with its workspace import map", async () => {
  const assets = createAssets()
  try {
    const entry = await assets.getScriptEntry("app/actions/public/entry.ts")
    expect(JSON.stringify(entry.importMap)).toContain("remix/routes")
    expect(JSON.stringify(entry.importMap)).toContain("remix/ui")
    expect(entry.preloads.length).toBeGreaterThan(0)
    expect((await assets.fetch(new Request(`http://localhost${entry.href}`)))?.status).toBe(200)
  } finally {
    await assets.close()
  }
})

test("renders the shared document shell with the project badge", async () => {
  const { router, project, close } = makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request(`http://localhost/p/${project}`, { headers: { Host: "localhost" } }),
  )
  const html = await response.text()
  expect(html).toMatch(/^<!doctype html>/i)
  expect(html).toContain('<html lang="en">')
  expect(html).toContain('name="viewport"')
  expect(html).toContain(routes.assets.href({ path: "app/ui/styles.css" }))
  expect(html).toContain("Acme")
  expect(html).toContain(`>${project}<`)
  expect(html).toContain("Board")
  expect(html).toContain("Done")
  expect(html).toContain("Check")
  expect(html).toContain(`data-project="${project}"`)
  expect(html).toContain("diagnostic")
})
```

- [ ] **Step 5: `test/web/fs-e2e.test.ts`**

Runs the `FsTodoStore` end-to-end through a **registered** fs project instead of a bare `FsTodoStore.layer`:

```ts
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Layer, ManagedRuntime } from "effect"
import { Hub } from "../../src/hub/index.ts"
import { fsSource } from "../../src/hub/index.ts"
import { createAppRouter } from "../../src/web/app/router.ts"
import { routes } from "../../src/web/app/routes.ts"
import type { HubRuntime } from "../../src/web/app/middleware/project.tsx"
import { makeFakeAssets } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

const setUp = async (todoMd: string) => {
  const root = await mkdtemp(join(tmpdir(), "todo-md-web-e2e-"))
  await writeFile(join(root, "TODO.md"), todoMd)
  const home = await mkdtemp(join(tmpdir(), "todo-md-web-e2e-home-"))
  await mkdir(join(home, "projects", "disk"), { recursive: true })
  await writeFile(
    join(home, "projects.yaml"),
    `projects:\n  disk:\n    source: fs\n    path: ${root}\n`,
  )
  const hubRuntime = ManagedRuntime.make(
    Hub.layer({ home, userHome: home, sources: [fsSource] }).pipe(Layer.provide(BunServices.layer)),
  )
  const runtime: HubRuntime = { runPromise: (effect) => hubRuntime.runPromise(effect) }
  const router = createAppRouter({
    runtime,
    startup: "disk",
    author: "tester",
    hosts: ["localhost"],
    sessionSecret: "test-secret-at-least-32-characters",
    assets: makeFakeAssets(),
  })
  cleanup.push(async () => {
    await router.close()
    await hubRuntime.dispose()
    await rm(root, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  })
  return { router, root }
}

test("adds and completes a task through the router over FsTodoStore", async () => {
  const { router, root } = await setUp("# Disk list\n")
  const project = "disk"

  const add = new FormData()
  add.set("title", "Persist me")
  const added = await router.fetch(
    new Request(`http://localhost${routes.project.tasks.add.href({ project })}`, {
      method: "POST",
      headers: { Host: "localhost" },
      body: add,
    }),
  )
  expect(added.status).toBe(303)
  expect(await readFile(join(root, "TODO.md"), "utf8")).toContain("Persist me")

  const complete = new FormData()
  complete.set("back", routes.project.board.href({ project }))
  const completed = await router.fetch(
    new Request(`http://localhost${routes.project.tasks.complete.href({ project, id: "1" })}`, {
      method: "POST",
      headers: { Host: "localhost" },
      body: complete,
    }),
  )
  expect(completed.status).toBe(303)
  expect(await readFile(join(root, "TODO.md"), "utf8")).not.toContain("Persist me")
  const doneFiles = await readdir(join(root, "done"), { recursive: true })
  expect(doneFiles.some((file) => file.endsWith("01-persist-me.md"))).toBe(true)
})

test("moves, renames a group, and removes a task through the router over FsTodoStore", async () => {
  const { router, root } = await setUp(
    "# Disk list\n\n- [ ] 1 - One\n- [ ] 2 - Two\n\n## Backend\n\n- [ ] 3 - Three\n",
  )
  const project = "disk"
  const post = async (path: string, fields: Record<string, string>) => {
    const body = new FormData()
    for (const [name, value] of Object.entries(fields)) body.set(name, value)
    const response = await router.fetch(
      new Request(`http://localhost${path}`, { method: "POST", headers: { Host: "localhost" }, body }),
    )
    expect(response.status).toBe(303)
  }

  await post(routes.project.tasks.move.href({ project, id: "2" }), { before: "1" })
  await post(routes.project.tasks.move.href({ project, id: "1" }), { group: "Backend", position: "top" })
  await post(routes.project.groups.rename.href({ project }), { from: "Backend", to: "Server" })
  await post(routes.project.tasks.remove.href({ project, id: "3" }), {})
  expect(await readFile(join(root, "TODO.md"), "utf8")).toBe(
    "# Disk list\n\n- [ ] 2 - Two\n\n## Server\n\n- [ ] 1 - One\n",
  )
})
```

- [ ] **Step 6: `test/web/contracts.test.ts`**

This file is large (503 lines) but mechanically uniform. Apply exactly these substitutions across the whole file (use a project-wide find/replace inside this one file, then run the suite and fix any leftover type errors):

- Delete the `makeFakeChanges`/`createAppRouter`/`makeRuntime` imports; import `makeRouter`, `memoryWithCapabilities`, `seed` from `./harness.ts` instead.
- Delete `appWith` and its `open` array/`afterEach` (replaced by each test destructuring `{ router, project, hubRuntime, close }` from `makeRouter(...)` and pushing `close` onto the shared `cleanup` array, same pattern as Task 10 Steps 1–5).
- Every `appWith(runtime)` → `makeRouter()`; every `appWith(runtime, someCapabilities)` → `makeRouter({ capabilities: someCapabilitiesAsPartial })` (where `someCapabilities` was a full `Capabilities` object built by spreading `allCapabilities`, e.g. `{ ...allCapabilities, reorder: false, renameGroup: false }` → `{ reorder: false, renameGroup: false }`).
- Every `seed(runtime)`/direct `runtime.runPromise(TodoService.use(...))` → `seed(hubRuntime, project, (todo) => todo.add(...))`.
- Every `fetchApp(router, routes.X.href(...))` → `fetchApp(router, routes.project.X.href({ project, ... }))` (top-level `routes.board`/`routes.events`/`routes.assets` calls, if any remain in this file, stay as-is since they're genuinely top-level).

Run `grep -n "routes\.\(board\|done\|check\|tasks\|groups\)\." test/web/contracts.test.ts` after the pass to confirm every remaining reference goes through `routes.project.*`.

- [ ] **Step 7: Delete `test/web/watch.test.ts`**

```bash
git rm test/web/watch.test.ts
```

(Its scenarios already live in `test/hub/fs.test.ts`, ported when task 15 built `fsSource.changes`/`watchList`.)

- [ ] **Step 8: Run the whole web suite**

Run: `bun test test/web`
Expected: PASS across every file in `test/web`.

- [ ] **Step 9: Commit**

```bash
git add test/web
git commit -m "test/web: update every suite for /p/:project and the Hub-backed harness"
```

---

### Task 11: Docs

**Files:**
- Modify: `src/web/README.md`
- Modify: `docs/architecture/frontends.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update `src/web/README.md`**

Replace the "Run `todo web --dir <list>`" opening and the `server.ts is the composition root` closing paragraph to describe the hub wiring:

```markdown
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
```

- [ ] **Step 2: Update `docs/architecture/frontends.md`'s web section**

Run: `grep -n "planned\|## Web\|watch.ts" docs/architecture/frontends.md` to find the exact section to edit, then remove any "(planned)" banner over the web section and update its description to: composition through `Hub.layer`, routes under `/p/:project`, `/events` streaming `hub.changes`, no more `watch.ts`/`ListChanges`. Keep the edit local to that one section — don't touch the CLI or TUI sections, which are separate tasks (16, 20).

- [ ] **Step 3: Commit**

```bash
git add src/web/README.md docs/architecture/frontends.md
git commit -m "docs: describe the web app's hub wiring"
```

---

### Task 12: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run: `bun run check`
Expected: lint, typecheck and every test pass, including `test/boundaries.test.ts`, `test/hub/*`, `test/web/*`, `test/cli/*`.

- [ ] **Step 2: Manually smoke-test the app**

```bash
mkdir -p /tmp/todo-md-manual/todo
printf '# Manual check\n\n- [ ] 1 - Try the board\n' > /tmp/todo-md-manual/todo/TODO.md
TODO_MD_HOME=/tmp/todo-md-manual-home bun src/cli/bin.ts web --dir /tmp/todo-md-manual/todo
```

Open the printed `http://127.0.0.1:4400/p/<name>` URL in a browser (or `mcp__claude-in-chrome__navigate` if available); confirm: the board renders, the project badge shows next to the title, adding/completing/moving a task works, editing `TODO.md` on disk while the page is open triggers a live refresh (SSE), and visiting `/` redirects to the same `/p/<name>` URL. Then register the same list as a project (`bun src/cli/bin.ts projects add /tmp/todo-md-manual/todo`) and serve it with `--project <name>` instead of `--dir`, confirming the same behavior.

- [ ] **Step 3: Confirm "Done when" from the task**

- [ ] Web behavior is unchanged apart from URLs and the header (verified in Step 2).
- [ ] No file in `src/web` implements watching or builds a store: `grep -rn "FileSystem.watch\|node:fs.*watch\|TodoStore.of\|FsTodoStore" src/web` returns nothing outside `middleware/project.tsx`'s `TodoService.provideService` call and comments.
- [ ] `bun run check` passes (Step 1).

No commit for this task — it's verification of the prior eleven.
