# Web dashboard and project management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web app the place to see every project: a dashboard at `GET /` with cross-project filters, a `/projects` page that adds, renames and removes projects, sync buttons, a header project switcher, and live refresh for both new pages — all working without JavaScript.

**Architecture:** Task 17 put every project page under `/p/:project` behind a `loadProject` middleware that resolves one project. This plan adds a second, *hub-level* family of routes that never resolve a single project: they talk to `HubRuntime` (already on `RouterOptions`) directly through `hub.overview`, `hub.projects`, `hub.add`, `hub.rename`, `hub.remove`, `hub.sync` and `hub.syncAll`. Two new controllers (`app/actions/dashboard/`, `app/actions/projects/`) render string-returning UI modules (`app/ui/dashboard.tsx`, `app/ui/projects.tsx`, `app/ui/status.tsx`) through the existing `Document`, which grows a hub header (switcher + Dashboard/Projects links). Two small pieces move into `hub` so the CLI and the web share them: the one-line sync-status text, and the rule that registering an open unregistered list replaces it instead of duplicating it.

**Tech Stack:** Bun, Effect 4, `remix` (fetch-router + `remix/ui` JSX), `bun:test`.

**Spec:** [docs/superpowers/specs/2026-09-13-hub-design.md §6 Web](../specs/2026-09-13-hub-design.md#6-frontends) and [docs/superpowers/specs/2026-09-12-web-app-design.md § Visual design](../specs/2026-09-12-web-app-design.md#visual-design); task [`todo/TODO.md` #18](../../../todo/TODO.md).

## Global Constraints

- `bun run check` (lint + typecheck + tests) must pass at the end of **every** task.
- `test/boundaries.test.ts` governs `src/web`'s imports: relative paths into `spec`, `core` and `hub` only — never the published `@lemol/todo-md/*` specifiers, never `src/cli`, and no `node:`/`bun` imports outside `server.ts` and `app/assets.ts`.
- **Every page and every form works with JavaScript disabled.** Filters are a GET form; the switcher is a GET form to a redirect route; every mutation is a `POST` + 303 redirect + flash. JavaScript only adds live refresh and submit-on-change.
- **Minimal diffs.** Edit existing files in place; do not reformat or re-derive files whose only change is one new prop.
- Visual language from the web-app design: one 760px column, hairlines not cards, semantic pastels (`--ready-bg/-text`, `--blocked-bg/-text`, `--error-bg/-text`, `--info-bg/-text`), serif headings, mono for IDs and status. New styles go in `app/ui/styles.css` using the existing tokens; no new colors.
- UI modules in `app/ui/` return **HTML strings** (see `app/ui/board.tsx`, `secondary.tsx`) and escape every interpolated value with `escapeHtml`. Only `document.tsx` and controllers use JSX.
- Effect version stays pinned; do not touch `package.json`.
- Task 18's four stages map to these tasks: **A** hub groundwork (1–2), **B** dashboard (3–6), **C** projects (7–8), **D** sync, switcher, live refresh, docs (9–11). Each task commits on its own; stages may be squashed before the PR.

---

## Design notes carried into the tasks

These resolve ambiguity in the task text against what the code supports. Each is referenced from the task where it matters.

1. **`statusText` moves into the hub.** The wording task 18 asks for (`synced 3h ago`, `never synced`, `error: …`, `ahead 1`, `diverged`) already exists at `src/cli/render.ts:169`, which `src/web` cannot import. It becomes `src/hub/status.ts` and both frontends import it, so the two never drift. `app/ui/status.tsx` only chooses the pastel and wraps the text in a badge. (Task 1)
2. **Register is fixed in the hub, not the web.** From task 14's review: registering an already-open unregistered list under a *different* name leaves the unregistered entry in `projects()`, because `add` only calls `unregistered.forget(name)` for the new name, and unregistered projects are keyed by *list path*. `hub.add` instead asks the source `owns(config, list)` for each open list and forgets the matching one, which fixes the CLI's `todo projects` too. (Task 2)
3. **400 is for invalid enumerations only.** `state` must be `ready`/`blocked` and `view` must be `projects`/`flat`; anything else is a 400 page. An unknown `project=` name is *not* a 400: `overviewOf` already turns it into a `ProjectNotFound` error entry (`src/hub/overview.ts:59`), and rendering that entry is strictly more useful than a blank error page. An unknown `source=` is kept by design (`overviewOf` filters, never rejects) and simply matches nothing.
4. **The dashboard needs both `hub.overview` and `hub.projects`.** `overviewOf` defaults to registered projects only, so an unregistered startup project would vanish; and the filter bar and switcher need every project regardless of the current filter. The controller calls `hub.projects()` once for the chrome and the filter bar, and `hub.overview(query)` for the sections. When the startup project is unregistered it is passed explicitly in `query.projects` so it gets a section, shown first with a **Register** button.
5. **`respond`/`respondDefect` must tolerate a missing project.** Both call `projectOf(context)` (`app/actions/respond.tsx:57`), which reads `projectInfoContext` — never set on hub-level routes. They switch to a new `currentProject(context)` that returns `undefined` when the key is unset.
6. **Live refresh gets an explicit event list.** `entry.ts` currently refreshes only when an event's `project` equals the page's `data-project`. Hub pages have no project, so the live region declares the kinds it listens to: the dashboard `data-live-events="changed synced registry"`, `/projects` `data-live-events="registry synced"`. Project pages keep `data-project` and are unchanged. The decision stays a pure function in `refresh.ts`, unit-tested.
7. **`back` on hub forms is validated like the board's.** `localBack` (`app/actions/forms.ts:96`) needs a project to fall back to; hub forms get `hubBack(value, fallback)` with the same character rules and a hub-level fallback.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/hub/status.ts` | `statusText(status, now)`: a `ProjectStatus` as one line for people. |
| `src/web/app/actions/dashboard/controller.tsx` | `GET /`, `GET /go`. |
| `src/web/app/actions/dashboard/query.ts` | URL → `OverviewQuery` + view, and back to a query string. Pure. |
| `src/web/app/actions/projects/controller.tsx` | `GET /projects`, `POST /projects`, rename, remove. |
| `src/web/app/actions/sync/controller.tsx` | `POST /sync`, `POST /p/:project/sync`. |
| `src/web/app/ui/status.tsx` | The sync-status badge, shared by dashboard, `/projects` and the board header. |
| `src/web/app/ui/dashboard.tsx` | Dashboard markup: filter bar, project sections, flat list, empty state. |
| `src/web/app/ui/projects.tsx` | `/projects` markup: table, add form, rename form, remove confirmation. |
| `test/web/dashboard.test.ts`, `test/web/projects.test.ts`, `test/web/sync.test.ts` | Router-level tests for the new routes. |
| `test/web/actions/dashboard-query.test.ts` | Unit tests for the query parser. |

**Modified**

| File | Change |
| --- | --- |
| `src/hub/resolve.ts` | `Unregistered` gains `lists()`, `byList()`, `forgetList()`. |
| `src/hub/Hub.ts` | `add` forgets the unregistered entry for the list it just registered. |
| `src/hub/index.ts` | Export `statusText`. |
| `src/hub/README.md` | Document both. |
| `src/cli/render.ts`, `src/cli/commands/projects.ts` | Import `statusText` from the hub. |
| `src/web/app/routes.ts` | `board` → `dashboard`; new `go`, `sync`, `projects`, `project.sync`. |
| `src/web/app/router.ts` | Map the three new controllers. |
| `src/web/app/ui/document.tsx` | Hub header: switcher, Dashboard/Projects links, `data-live-events`. |
| `src/web/app/ui/styles.css` | Styles for the switcher, filter bar, project sections and the projects table. |
| `src/web/app/actions/page.ts` | `currentProject`, `hubRuntimeOf`. |
| `src/web/app/actions/respond.tsx` | Tolerate a missing project. |
| `src/web/app/actions/controller.tsx` | Drop `boardRedirect`; board header shows the sync status. |
| `src/web/app/actions/forms.ts` | `hubBack`. |
| `src/web/app/actions/public/refresh.ts`, `public/entry.ts` | Event-list live refresh. |
| `test/web/harness.ts` | Multi-project homes and syncable test sources. |
| `test/web/routes.test.ts`, `test/web/security.test.ts` | New routes. |
| `src/web/README.md`, `docs/architecture/frontends.md`, `README.md` | Docs. |

---

## Task 1: Share the sync-status text with the hub

Design note 1. Pure move plus two import updates; no behavior changes.

**Files:**
- Create: `src/hub/status.ts`
- Modify: `src/hub/index.ts`, `src/hub/README.md`, `src/cli/render.ts:168-184`, `src/cli/commands/projects.ts:12`
- Test: `test/hub/status.test.ts`

**Interfaces:**
- Produces: `statusText(status: ProjectStatus, now: DateTime.Utc): string`, exported from `src/hub/index.ts`.

- [ ] **Step 1: Write the failing test**

Append to `test/hub/status.test.ts` (inside the existing `describe("status", …)`, after the last case):

```ts
  describe("statusText", () => {
    const now = DateTime.makeUnsafe("2026-09-16T12:00:00.000Z")
    const at = (iso: string) => DateTime.makeUnsafe(iso)

    test("reads a never-synced project", () => {
      expect(statusText({ result: "never" }, now)).toBe("never synced")
      expect(statusText({ result: "ok" }, now)).toBe("never synced")
    })

    test("reads elapsed time in the largest whole unit", () => {
      expect(statusText({ result: "ok", lastSync: at("2026-09-16T11:59:30.000Z") }, now)).toBe(
        "synced just now",
      )
      expect(statusText({ result: "ok", lastSync: at("2026-09-16T11:45:00.000Z") }, now)).toBe(
        "synced 15m ago",
      )
      expect(statusText({ result: "ok", lastSync: at("2026-09-16T09:00:00.000Z") }, now)).toBe(
        "synced 3h ago",
      )
      expect(statusText({ result: "ok", lastSync: at("2026-09-14T12:00:00.000Z") }, now)).toBe(
        "synced 2d ago",
      )
    })

    test("prefers diverged, then ahead, then an error", () => {
      expect(statusText({ result: "ok", diverged: true, ahead: 2 }, now)).toBe("diverged")
      expect(statusText({ result: "error", ahead: 1 }, now)).toBe("ahead 1")
      expect(statusText({ result: "error" }, now)).toBe("error: unknown error")
      expect(statusText({ result: "error", error: "auth failed" }, now)).toBe("error: auth failed")
    })

    test("never reports a negative age", () => {
      expect(statusText({ result: "ok", lastSync: at("2026-09-16T12:30:00.000Z") }, now)).toBe(
        "synced just now",
      )
    })
  })
```

Add `test` to the `bun:test` import at the top of the file and `statusText` to the `../../src/hub/index.ts` import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/hub/status.test.ts`
Expected: FAIL — `statusText` is not exported from `src/hub/index.ts`.

- [ ] **Step 3: Create `src/hub/status.ts`**

```ts
/**
 * A project's sync status as one line for people. Frontends share this so the
 * CLI, the web app and any future TUI use the same words.
 */

import type { DateTime } from "effect"
import { DateTime as DT } from "effect"
import type { ProjectStatus } from "./Source.ts"

/** `diverged`, `ahead 1`, `error: …`, `never synced` or `synced 3h ago`. */
export const statusText = (status: ProjectStatus, now: DateTime.Utc): string => {
  if (status.diverged === true) return "diverged"
  if (status.ahead !== undefined && status.ahead > 0) return `ahead ${status.ahead}`
  if (status.result === "error") return `error: ${status.error ?? "unknown error"}`
  if (status.result === "never" || status.lastSync === undefined) return "never synced"
  const seconds = Math.max(
    0,
    Math.floor((DT.toEpochMillis(now) - DT.toEpochMillis(status.lastSync)) / 1000),
  )
  if (seconds < 60) return "synced just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `synced ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `synced ${hours}h ago`
  return `synced ${Math.floor(hours / 24)}d ago`
}
```

Use a single `import { DateTime } from "effect"` if Biome prefers it over the split type/value import — the file only needs `DateTime.Utc` and `DateTime.toEpochMillis`.

- [ ] **Step 4: Export it and point the CLI at it**

In `src/hub/index.ts`, beside the other exports:

```ts
export { statusText } from "./status.ts"
```

In `src/cli/render.ts`, delete lines 168–184 (the `/** A project's one-line sync status… */` comment and the `statusText` function) and re-export it so existing importers keep working:

```ts
export { statusText } from "../hub/index.ts"
```

Remove `type ProjectStatus` from render.ts's `../hub/index.ts` import if nothing else uses it, and remove the `DateTime` import if `render.ts` no longer needs it (check: other helpers may still use it — leave it if so).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run check`
Expected: PASS. `test/cli/render.test.ts` must still pass unchanged — that is the proof the wording did not move.

- [ ] **Step 6: Document it**

In `src/hub/README.md`, add one line under the module's file list:

```markdown
- `status.ts` — `statusText`: a `ProjectStatus` as one line for people, shared by every frontend.
```

- [ ] **Step 7: Commit**

```bash
git add src/hub/status.ts src/hub/index.ts src/hub/README.md src/cli/render.ts test/hub/status.test.ts
git commit -m "refactor(hub): share the sync-status text with every frontend"
```

---

## Task 2: Registering an open list replaces its unregistered entry

Design note 2. This is task 18's "Decide how Register replaces it", fixed once in the hub.

**Files:**
- Modify: `src/hub/resolve.ts:19-52`, `src/hub/Hub.ts` (`add`, near line 319), `src/hub/README.md`
- Test: `test/hub/Hub.test.ts`

**Interfaces:**
- Consumes: `Source.owns(config, listRoot)` (`src/hub/Source.ts`), implemented by `fsSource` (`src/hub/sources/fs.ts:97`).
- Produces: `Unregistered.lists()`, `Unregistered.byList(list)`, `Unregistered.forgetList(list)`.

- [ ] **Step 1: Write the failing test**

Append to `test/hub/Hub.test.ts`, in the `describe` that covers `add`:

```ts
  effectTest(
    "registering an open list under another name replaces its unregistered entry",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])
      // Opening the list unregistered names it after its directory.
      const opened = yield* hub.resolve({ dir: `${root}/lists/acme`, cwd: root })
      expect(opened.registered).toBe(false)
      expect((yield* hub.projects()).map((info) => info.name)).toEqual([opened.name])

      yield* hub.add({ name: "work", source: "fs", config: { path: `${root}/lists/acme` } })

      const after = yield* hub.projects()
      expect(after.map((info) => info.name)).toEqual(["work"])
      expect(after[0]?.registered).toBe(true)
    }),
  ).pipe(/* keep the file's existing layer-providing pipe for effectTest cases */)
```

Seed the disk with a list at `lists/acme` using the file's existing `diskWith`/`md` helpers, matching how the neighbouring `resolve` cases build one. Read `test/hub/resolve.test.ts` for the exact fixture shape before writing this.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/hub/Hub.test.ts`
Expected: FAIL — `after.map(…)` is `["work", "acme"]`: the unregistered entry survives as a second project over the same list.

- [ ] **Step 3: Give `Unregistered` list-keyed access**

In `src/hub/resolve.ts`, extend the interface (keep the existing members):

```ts
/** Unregistered projects opened in one hub: fs lists, one per list path, kept for the hub's lifetime. */
export interface Unregistered {
  get(name: string): Project | undefined
  all(): ReadonlyArray<Project>
  forget(name: string): void
  /** The list paths currently open, for sources that can say which list is theirs. */
  lists(): ReadonlyArray<string>
  byList(list: string): Project | undefined
  forgetList(list: string): void
  /** The project over `list`, opened on first use with a name that is not in `registered` or already open. */
  open(list: string, registered: ReadonlyArray<string>): Project
}
```

and in `makeUnregistered`, beside `all` and `forget`:

```ts
    lists: () => [...byPath.keys()],
    byList: (list) => byPath.get(list),
    forgetList: (list) => {
      byPath.delete(list)
    },
```

- [ ] **Step 4: Forget the registered list in `add`**

In `src/hub/Hub.ts`, above the returned `Hub.of({…})` (next to the other helpers such as `describe`), add:

```ts
    /**
     * A list that was open unregistered is now a registered project: drop the
     * unregistered entry whatever name it was opened under, so the same list
     * never shows up as two projects (task 14's review).
     */
    const forgetOpenList = (source: AnySource, config: unknown) => {
      const owns = source.owns
      if (owns === undefined) return Effect.void
      return Effect.forEach(
        unregistered.lists(),
        (list) =>
          Effect.flatMap(inEnv(owns(config, list)), (owned) => {
            if (!owned) return Effect.void
            const open = unregistered.byList(list)
            unregistered.forgetList(list)
            return open === undefined ? Effect.void : forget(open.name)
          }),
        { discard: true },
      )
    }
```

Then in `add`, replace the line `unregistered.forget(name)` (around `src/hub/Hub.ts:319`) with:

```ts
          yield* forgetOpenList(source, config)
          unregistered.forget(name)
```

`unregistered.forget(name)` stays for the same-name case, which needs no `owns`. `forget(name)` and `registryChanged` on the following lines are unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run check`
Expected: PASS, including `test/hub/changes.test.ts` — dropping a watched unregistered project must not leave a watcher behind; `changes.reconcile` already runs off `registryChanged`.

- [ ] **Step 6: Document it**

In `src/hub/README.md`, in the paragraph describing `add`, add:

```markdown
Registering a list that is already open unregistered replaces that entry: `add`
asks the source `owns(config, list)` for each open list and forgets the match, so
the same list is never two projects.
```

- [ ] **Step 7: Commit**

```bash
git add src/hub/resolve.ts src/hub/Hub.ts src/hub/README.md test/hub/Hub.test.ts
git commit -m "fix(hub): registering an open list replaces its unregistered entry"
```

---

## Task 3: Hub routes and a hub-capable chrome

No new pages yet — this task moves the plumbing so tasks 4–9 can render hub pages: routes, a `Document` header with the switcher, error responses without a project, and a `HubRuntime` accessor.

**Files:**
- Modify: `src/web/app/routes.ts`, `src/web/app/actions/page.ts`, `src/web/app/actions/respond.tsx`, `src/web/app/ui/document.tsx`, `src/web/app/ui/styles.css`, `src/web/app/router.ts`
- Test: `test/web/routes.test.ts`, `test/web/ui.test.ts`

**Interfaces:**
- Produces:
  - `routes.dashboard` (`GET /`), `routes.go` (`GET /go`), `routes.sync` (`POST /sync`), `routes.projects.{index,add,rename,remove}`, `routes.project.sync`.
  - `currentProject(context: WebContext): string | undefined`
  - `hubRuntimeOf(context: WebContext): HubRuntime` — reads the runtime a new `provideHub` middleware puts on the context.
  - `DocumentOptions.switcher?: ReadonlyArray<SwitcherProject>` and `DocumentOptions.liveEvents?: ReadonlyArray<string>`, with `interface SwitcherProject { readonly name: string; readonly registered: boolean }`.

- [ ] **Step 1: Write the failing route test**

In `test/web/routes.test.ts`, replace `expect(routes.board.href()).toBe("/")` with the dashboard and add the new routes:

```ts
  expect(routes.dashboard.href()).toBe("/")
  expect(routes.go.href()).toBe("/go")
  expect(routes.sync.href()).toBe("/sync")
  expect(routes.projects.index.href()).toBe("/projects")
  expect(routes.projects.add.href()).toBe("/projects")
  expect(routes.projects.rename.href({ name: "acme" })).toBe("/projects/acme/rename")
  expect(routes.projects.remove.href({ name: "acme" })).toBe("/projects/acme/remove")
  expect(routes.project.sync.href({ project: "acme" })).toBe("/p/acme/sync")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/web/routes.test.ts`
Expected: FAIL — `routes.dashboard` is undefined.

- [ ] **Step 3: Add the routes**

`src/web/app/routes.ts` becomes:

```ts
import { get, post, route } from "remix/routes"

export const routes = route({
  dashboard: get("/"),
  events: get("/events"),
  assets: get("/assets/*path"),
  /** The header switcher posts here as a GET form, then redirects to the project's board. */
  go: get("/go"),
  sync: post("/sync"),
  projects: route("/projects", {
    index: get(""),
    add: post(""),
    rename: post(":name/rename"),
    remove: post(":name/remove"),
  }),
  project: route("/p/:project", {
    board: get("/"),
    done: get("/done"),
    check: get("/check"),
    sync: post("/sync"),
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

- [ ] **Step 4: Run the route test to verify it passes**

Run: `bun test test/web/routes.test.ts`
Expected: PASS. `bun run check` will still fail: `app/actions/controller.tsx` references `routes.board`. Leave that to step 6.

- [ ] **Step 5: Make the hub runtime and the current project reachable from any route**

Add to `src/web/app/middleware/project.tsx`, below `HubRuntime`:

```ts
/** Puts the hub runtime on the context for routes that have no single project. */
export const provideHub =
  (runtime: HubRuntime): Middleware =>
  (context, next) => {
    context.set(hubRuntimeContext, runtime)
    return next()
  }
```

and in `src/web/app/middleware/todo.ts`, beside the existing keys:

```ts
export const hubRuntimeContext = createContextKey<HubRuntime>()
```

(Keep the `HubRuntime` type in `project.tsx` and import the type into `todo.ts`, or move the interface into `todo.ts` and re-export it from `project.tsx` — whichever keeps the import graph acyclic. Check for a cycle before choosing.)

Then in `src/web/app/actions/page.ts`:

```ts
/** The project this request resolved, or `undefined` on hub-level routes. */
export const currentProject = (context: WebContext): string | undefined => {
  try {
    return (
      context as { readonly get: (key: typeof projectInfoContext) => ProjectInfo | undefined }
    ).get(projectInfoContext)?.name
  } catch {
    // Hub routes never run `loadProject`, so the key is unset.
    return undefined
  }
}

export const hubRuntimeOf = (context: WebContext): HubRuntime =>
  (context as { readonly get: (key: typeof hubRuntimeContext) => HubRuntime }).get(
    hubRuntimeContext,
  )
```

In `src/web/app/actions/respond.tsx`, change both `respond` and `respondDefect` to use it:

```ts
export const respond = (context: WebContext, error: unknown): Response => {
  const status = statusFor(error)
  const project = currentProject(context)
  return renderPage(
    context,
    <ErrorPage
      status={status}
      message={errorDescription(error)}
      {...(project === undefined ? {} : { project })}
      scriptEntry={scriptEntryOf(context)}
    />,
    { status },
  )
}
```

and the same `{...(project === undefined ? {} : { project })}` spread in `respondDefect`.

- [ ] **Step 6: Write the failing chrome test**

Append to `test/web/ui.test.ts`:

```ts
test("the header carries the switcher, hub links and the live event list", () => {
  const html = renderDocument({
    title: "Acme",
    content: "<p>body</p>",
    switcher: [
      { name: "acme", registered: true },
      { name: "list", registered: false },
    ],
    liveEvents: ["registry", "synced"],
  })
  expect(html).toContain(`action="/go"`)
  expect(html).toContain(`<option value="acme"`)
  expect(html).toContain(`list (not registered)`)
  expect(html).toContain(`href="/"`)
  expect(html).toContain(`href="/projects"`)
  expect(html).toContain(`data-live-events="registry synced"`)
  // A hub page has no project, so no board nav and no data-project.
  expect(html).not.toContain("data-project")
})
```

`renderDocument` is whatever `test/web/ui.test.ts` already uses to render `Document` to a string — read the file and reuse its existing helper rather than inventing one.

- [ ] **Step 7: Run it to verify it fails**

Run: `bun test test/web/ui.test.ts`
Expected: FAIL — no `/go` form in the header.

- [ ] **Step 8: Extend `Document`**

In `src/web/app/ui/document.tsx`, add to `DocumentOptions`:

```ts
export interface SwitcherProject {
  readonly name: string
  readonly registered: boolean
}

  /** Every project, for the header switcher; omitted hides it (e.g. an error page). */
  readonly switcher?: ReadonlyArray<SwitcherProject>
  /**
   * The hub event kinds this page's live region listens to. Omitted means
   * "this page's project's own `changed` and `synced`", which is `data-project`.
   */
  readonly liveEvents?: ReadonlyArray<string>
```

In the returned markup, before `nav`:

```tsx
    const switcher =
      options.switcher === undefined || options.switcher.length === 0 ? null : (
        <form class="switcher" method="get" action={routes.go.href()}>
          <label class="visually-hidden" for="switch-project">
            Project
          </label>
          <select id="switch-project" name="project" data-submit-on-change>
            {options.switcher.map((entry) => (
              <option
                value={entry.name}
                key={entry.name}
                {...(entry.name === project ? { selected: true } : {})}
              >
                {entry.registered ? entry.name : `${entry.name} (not registered)`}
              </option>
            ))}
          </select>
          <button class="secondary" type="submit">
            Go
          </button>
        </form>
      )
```

and the nav becomes hub-aware:

```tsx
    const nav = (
      <nav aria-label="Projects">
        <a href={routes.dashboard.href()}>Dashboard</a>
        <a href={routes.projects.index.href()}>Projects</a>
        {project === undefined ? null : (
          <>
            <a href={boardHref}>Board</a>
            <a href={routes.project.done.href({ project })}>Done</a>
            <a class="diagnostic-link" href={routes.project.check.href({ project })}>
              Check {badge}
            </a>
          </>
        )}
      </nav>
    )
```

and `<main>` carries the event list:

```tsx
          <main
            data-live-region
            {...(project === undefined ? {} : { "data-project": project })}
            {...(options.liveEvents === undefined
              ? {}
              : { "data-live-events": options.liveEvents.join(" ") })}
            innerHTML={options.content}
          />
```

`{switcher}` goes in the header between the title/badge and `{nav}`. The reload notice's "Reload" link should point at `boardHref`, which is already `/` for hub pages — no change needed.

- [ ] **Step 9: Style the header additions**

Append to `src/web/app/ui/styles.css`, using existing tokens only:

```css
.switcher {
  display: flex;
  gap: 6px;
  align-items: center;
}
.switcher select {
  max-width: 180px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  padding: 3px 6px;
  background: var(--surface);
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
header {
  flex-wrap: wrap;
}
```

(The last rule edits the existing `header` block instead of duplicating it — add `flex-wrap: wrap;` inside the block at `styles.css:42` so the switcher wraps on narrow screens.)

- [ ] **Step 10: Wire `provideHub` and keep the build green**

In `src/web/app/router.ts`, add `provideHub(options.runtime)` to the router's global `middleware` array, after `render({ assets })`. In `src/web/app/actions/controller.tsx`, delete `boardRedirect` and its `redirect`/`RequestContext` imports if nothing else needs them, and remove `board` from `createTopController`'s actions — task 4 adds the dashboard action in its place. Until then `GET /` 404s, which is fine inside this task but **not** at its commit, so do steps 10 and Task 4's steps 1–5 before committing if `bun run check` has a test asserting `GET /` redirects; if `test/web/contracts.test.ts` has such a test, delete it here and let Task 4's dashboard test replace it.

- [ ] **Step 11: Run the full gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/web/app/routes.ts src/web/app/router.ts src/web/app/ui/document.tsx src/web/app/ui/styles.css src/web/app/actions/page.ts src/web/app/actions/respond.tsx src/web/app/middleware test/web/routes.test.ts test/web/ui.test.ts
git commit -m "feat(web): add hub routes and a project switcher in the header"
```

---

## Task 4: Parse the dashboard's query parameters

Design note 3. A pure module so the controller stays thin and the rules are unit-tested.

**Files:**
- Create: `src/web/app/actions/dashboard/query.ts`
- Test: `test/web/actions/dashboard-query.test.ts`

**Interfaces:**
- Produces:

```ts
export type DashboardView = "projects" | "flat"
export interface DashboardQuery {
  readonly view: DashboardView
  readonly projects: ReadonlyArray<string>
  readonly sources: ReadonlyArray<string>
  readonly overview: OverviewQuery
}
export class InvalidQuery extends Error {}
export const parseDashboardQuery: (url: URL) => DashboardQuery  // throws InvalidQuery
export const dashboardHref: (query: DashboardQuery, patch?: Partial<…>) => string
```

- [ ] **Step 1: Write the failing test**

`test/web/actions/dashboard-query.test.ts`:

```ts
import { expect, test } from "bun:test"
import {
  dashboardHref,
  InvalidQuery,
  parseDashboardQuery,
} from "../../../src/web/app/actions/dashboard/query.ts"

const at = (search: string) => new URL(`http://localhost/${search}`)

test("defaults to the projects view with no filters", () => {
  const query = parseDashboardQuery(at(""))
  expect(query.view).toBe("projects")
  expect(query.projects).toEqual([])
  expect(query.sources).toEqual([])
  expect(query.overview).toEqual({})
})

test("maps repeatable project, source and tag parameters", () => {
  const query = parseDashboardQuery(at("?project=acme&project=work&source=fs&tag=docs&tag=web"))
  expect(query.projects).toEqual(["acme", "work"])
  expect(query.sources).toEqual(["fs"])
  expect(query.overview).toEqual({
    projects: ["acme", "work"],
    sources: ["fs"],
    filter: { tags: ["docs", "web"] },
  })
})

test("maps assignee and state into the task filter", () => {
  expect(parseDashboardQuery(at("?assignee=lemol&state=ready")).overview).toEqual({
    filter: { tags: [], assignee: "lemol", state: "ready" },
  })
})

test("drops blank values so an empty filter box is not a filter", () => {
  expect(parseDashboardQuery(at("?assignee=&tag=&project=")).overview).toEqual({})
})

test("accepts the flat view", () => {
  expect(parseDashboardQuery(at("?view=flat")).view).toBe("flat")
})

test("rejects an unknown state or view", () => {
  expect(() => parseDashboardQuery(at("?state=soon"))).toThrow(InvalidQuery)
  expect(() => parseDashboardQuery(at("?view=grid"))).toThrow(InvalidQuery)
})

test("dashboardHref round-trips a query and applies a patch", () => {
  const query = parseDashboardQuery(at("?project=acme&tag=docs&state=ready"))
  expect(dashboardHref(query)).toBe("/?project=acme&tag=docs&state=ready")
  expect(dashboardHref(query, { view: "flat" })).toBe("/?project=acme&tag=docs&state=ready&view=flat")
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/web/actions/dashboard-query.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

`src/web/app/actions/dashboard/query.ts`:

```ts
import type { OverviewQuery } from "../../../../hub/index.ts"
import { routes } from "../../routes.ts"

export type DashboardView = "projects" | "flat"

export interface DashboardQuery {
  readonly view: DashboardView
  /** The `project` boxes that are ticked; empty means every registered project. */
  readonly projects: ReadonlyArray<string>
  /** The `source` boxes that are ticked; empty means every kind. */
  readonly sources: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>
  readonly assignee: string | undefined
  readonly state: "ready" | "blocked" | undefined
  /** What `hub.overview` is called with. */
  readonly overview: OverviewQuery
}

/** An enumeration parameter the dashboard cannot honour; the controller answers 400. */
export class InvalidQuery extends Error {}

const list = (url: URL, name: string): ReadonlyArray<string> =>
  url.searchParams
    .getAll(name)
    .map((value) => value.trim())
    .filter((value) => value !== "")

const single = (url: URL, name: string): string | undefined => {
  const value = url.searchParams.get(name)?.trim()
  return value === undefined || value === "" ? undefined : value
}

/**
 * The dashboard's query parameters. Unknown `project` and `source` values are
 * kept: `overviewOf` turns an unknown project into an error entry and an
 * unknown source simply matches nothing. Only the enumerations are rejected.
 */
export const parseDashboardQuery = (url: URL): DashboardQuery => {
  const rawView = single(url, "view") ?? "projects"
  if (rawView !== "projects" && rawView !== "flat") throw new InvalidQuery("Invalid view.")
  const rawState = single(url, "state")
  if (rawState !== undefined && rawState !== "ready" && rawState !== "blocked")
    throw new InvalidQuery("Invalid state filter.")
  const projects = list(url, "project")
  const sources = list(url, "source")
  const tags = list(url, "tag")
  const assignee = single(url, "assignee")
  const hasFilter = tags.length > 0 || assignee !== undefined || rawState !== undefined
  return {
    view: rawView,
    projects,
    sources,
    tags,
    assignee,
    state: rawState,
    overview: {
      ...(projects.length === 0 ? {} : { projects }),
      ...(sources.length === 0 ? {} : { sources }),
      ...(hasFilter
        ? {
            filter: {
              tags,
              ...(assignee === undefined ? {} : { assignee }),
              ...(rawState === undefined ? {} : { state: rawState }),
            },
          }
        : {}),
    },
  }
}

export interface DashboardPatch {
  readonly view?: DashboardView
  readonly projects?: ReadonlyArray<string>
}

/** The dashboard URL for a query, with `patch` applied. Parameter order is stable. */
export const dashboardHref = (query: DashboardQuery, patch: DashboardPatch = {}): string => {
  const params = new URLSearchParams()
  for (const project of patch.projects ?? query.projects) params.append("project", project)
  for (const source of query.sources) params.append("source", source)
  for (const tag of query.tags) params.append("tag", tag)
  if (query.assignee !== undefined) params.set("assignee", query.assignee)
  if (query.state !== undefined) params.set("state", query.state)
  const view = patch.view ?? query.view
  if (view !== "projects") params.set("view", view)
  const search = params.toString()
  return search === "" ? routes.dashboard.href() : `${routes.dashboard.href()}?${search}`
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test test/web/actions/dashboard-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/app/actions/dashboard/query.ts test/web/actions/dashboard-query.test.ts
git commit -m "feat(web): parse the dashboard's filter query"
```

---

## Task 5: The sync-status badge

Small, shared by three pages, so it lands on its own with its own test.

**Files:**
- Create: `src/web/app/ui/status.tsx`
- Modify: `src/web/app/ui/styles.css`
- Test: `test/web/ui.test.ts`

**Interfaces:**
- Consumes: `statusText` from Task 1.
- Produces: `syncStatusBadge(status: ProjectStatus, now: DateTime.Utc): string` and `statusTone(status: ProjectStatus): "ready" | "blocked" | "error" | "muted"`.

- [ ] **Step 1: Write the failing test**

Append to `test/web/ui.test.ts`:

```ts
import { DateTime } from "effect"
import { statusTone, syncStatusBadge } from "../../src/web/app/ui/status.tsx"

test("the sync badge carries the hub's words and a matching pastel", () => {
  const now = DateTime.makeUnsafe("2026-09-16T12:00:00.000Z")
  expect(syncStatusBadge({ result: "never" }, now)).toContain("never synced")
  expect(syncStatusBadge({ result: "never" }, now)).toContain('class="badge muted sync-status"')
  expect(statusTone({ result: "error", error: "auth" })).toBe("error")
  expect(statusTone({ result: "ok", diverged: true })).toBe("error")
  expect(statusTone({ result: "ok", ahead: 2 })).toBe("blocked")
  expect(statusTone({ result: "ok", lastSync: now })).toBe("ready")
  expect(syncStatusBadge({ result: "error", error: "<script>" }, now)).toContain("&lt;script&gt;")
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/web/ui.test.ts`
Expected: FAIL — `src/web/app/ui/status.tsx` does not exist.

- [ ] **Step 3: Write the module**

`src/web/app/ui/status.tsx`:

```ts
import type { DateTime } from "effect"
import { type ProjectStatus, statusText } from "../../../hub/index.ts"
import { escapeHtml } from "./document.tsx"

/**
 * The pastel a status reads in. Badges always carry their text, so colour
 * never carries the meaning on its own.
 */
export const statusTone = (status: ProjectStatus): "ready" | "blocked" | "error" | "muted" => {
  if (status.diverged === true || status.result === "error") return "error"
  if (status.ahead !== undefined && status.ahead > 0) return "blocked"
  if (status.result === "never" || status.lastSync === undefined) return "muted"
  return "ready"
}

/** A project's sync status as a badge; the words come from the hub. */
export const syncStatusBadge = (status: ProjectStatus, now: DateTime.Utc): string =>
  `<span class="badge ${statusTone(status)} sync-status">${escapeHtml(statusText(status, now))}</span>`
```

- [ ] **Step 4: Style the muted badge**

In `src/web/app/ui/styles.css`, beside the other `.badge.*` rules:

```css
.badge.muted {
  background: #f7f6f3;
  color: var(--muted);
}
.sync-status {
  white-space: nowrap;
}
```

Use the same neutral chip background the design gives tags (`#F7F6F3`); if a `--chip-bg` token already exists in the file, use that instead of the literal.

- [ ] **Step 5: Run it to verify it passes**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/app/ui/status.tsx src/web/app/ui/styles.css test/web/ui.test.ts
git commit -m "feat(web): add the sync-status badge"
```

---

## Task 6: The dashboard

Design note 4. `GET /` and `GET /go`.

**Files:**
- Create: `src/web/app/ui/dashboard.tsx`, `src/web/app/actions/dashboard/controller.tsx`, `test/web/dashboard.test.ts`
- Modify: `src/web/app/router.ts`, `src/web/app/ui/styles.css`, `test/web/harness.ts`

**Interfaces:**
- Consumes: `parseDashboardQuery`, `dashboardHref`, `InvalidQuery` (Task 4); `syncStatusBadge` (Task 5); `currentProject`, `hubRuntimeOf` (Task 3); `Overview`, `OverviewEntry`, `ProjectInfo` from `hub`.
- Produces:
  - `DashboardPage(options: DashboardOptions): string`
  - `createDashboardController(options: { runtime: HubRuntime; startup: string })`
  - Harness: `makeRouter({ projects, startupDir })`.

- [ ] **Step 1: Teach the harness about several projects**

In `test/web/harness.ts`, replace `homeFor` and extend the options (keep `project`/`title` working so no existing test changes):

```ts
export interface HubProject {
  readonly name: string
  /** The registry entry's `source`; default `memory`. */
  readonly source?: string
  /** Extra entry fields, e.g. `{ title: "Acme" }`. */
  readonly fields?: Readonly<Record<string, unknown>>
}

/** A fresh hub home whose registry lists `projects`, written synchronously. */
const homeFor = (projects: ReadonlyArray<HubProject>): string => {
  const home = join(tmpdir(), `todo-md-web-test-${crypto.randomUUID()}`)
  mkdirSync(home, { recursive: true })
  const body = projects
    .map((project) =>
      [
        `  ${project.name}:`,
        `    source: ${project.source ?? "memory"}`,
        ...Object.entries(project.fields ?? {}).map(
          ([key, value]) => `    ${key}: ${JSON.stringify(value)}`,
        ),
      ].join("\n"),
    )
    .join("\n")
  writeFileSync(`${home}/projects.yaml`, `projects:\n${body}\n`)
  return home
}
```

In `MakeHubOptions` add `readonly projects?: ReadonlyArray<HubProject>`, and in `makeHub`:

```ts
  const entries =
    options.projects ??
    [{ name: options.project ?? "acme", fields: { title: options.title ?? "Acme" } }]
  const project = entries[0]?.name ?? "acme"
  const home = homeFor(entries)
```

`makeRouter` keeps using the first entry as `startup`.

- [ ] **Step 2: Write the failing dashboard tests**

`test/web/dashboard.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test"
import { makeRouter, seed } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

const open = (options: Parameters<typeof makeRouter>[0] = {}) => {
  const app = makeRouter(options)
  cleanup.push(app.close)
  return app
}

const fetchApp = (router: ReturnType<typeof makeRouter>["router"], path: string) =>
  router.fetch(new Request(`http://localhost${path}`, { headers: { Host: "localhost" } }))

const twoProjects = {
  projects: [
    { name: "acme", fields: { title: "Acme" } },
    { name: "work", fields: { title: "Work" } },
  ],
}

describe("dashboard", () => {
  test("lists projects in registry order with counts and next tasks", async () => {
    const app = open(twoProjects)
    await seed(app.hubRuntime, "acme", (todo) => todo.add({ title: "Write docs", tags: ["docs"] }))
    await seed(app.hubRuntime, "work", (todo) => todo.add({ title: "Ship it" }))
    const html = await (await fetchApp(app.router, "/")).text()
    expect(html.indexOf("Acme")).toBeLessThan(html.indexOf("Work"))
    expect(html).toContain("1 open")
    expect(html).toContain("1 ready")
    expect(html).toContain("Write docs")
    expect(html).toContain('href="/p/acme"')
    expect(html).toContain('class="badge muted sync-status"')
  })

  test("shows at most five ready tasks per project", async () => {
    const app = open()
    for (const index of [1, 2, 3, 4, 5, 6]) {
      await seed(app.hubRuntime, "acme", (todo) => todo.add({ title: `Task ${index}` }))
    }
    const html = await (await fetchApp(app.router, "/")).text()
    expect(html).toContain("Task 5")
    expect(html).not.toContain("Task 6")
    expect(html).toContain("1 more")
  })

  test("each filter narrows the results", async () => {
    const app = open(twoProjects)
    await seed(app.hubRuntime, "acme", (todo) =>
      todo.add({ title: "Write docs", tags: ["docs"], assignee: "lemol" }),
    )
    await seed(app.hubRuntime, "work", (todo) => todo.add({ title: "Ship it", tags: ["ops"] }))

    const byProject = await (await fetchApp(app.router, "/?project=work")).text()
    expect(byProject).toContain("Ship it")
    expect(byProject).not.toContain("Write docs")

    const byTag = await (await fetchApp(app.router, "/?tag=docs")).text()
    expect(byTag).toContain("Write docs")
    expect(byTag).not.toContain("Ship it")

    const byAssignee = await (await fetchApp(app.router, "/?assignee=lemol")).text()
    expect(byAssignee).toContain("Write docs")
    expect(byAssignee).not.toContain("Ship it")

    const bySource = await (await fetchApp(app.router, "/?source=git")).text()
    expect(bySource).not.toContain("Write docs")
  })

  test("the flat view lists qualified ids across projects", async () => {
    const app = open(twoProjects)
    await seed(app.hubRuntime, "acme", (todo) => todo.add({ title: "Write docs" }))
    await seed(app.hubRuntime, "work", (todo) => todo.add({ title: "Ship it" }))
    const html = await (await fetchApp(app.router, "/?view=flat")).text()
    expect(html).toContain("acme:01")
    expect(html).toContain("work:01")
    expect(html).toContain('href="/p/acme/tasks/1"')
  })

  test("rejects an invalid state or view with 400", async () => {
    const app = open()
    expect((await fetchApp(app.router, "/?state=soon")).status).toBe(400)
    expect((await fetchApp(app.router, "/?view=grid")).status).toBe(400)
  })

  test("an empty registry points at /projects", async () => {
    const app = open({ projects: [] })
    const html = await (await fetchApp(app.router, "/")).text()
    expect(html).toContain("No projects yet.")
    expect(html).toContain('href="/projects"')
  })

  test("the switcher redirects to a project's board", async () => {
    const app = open(twoProjects)
    const response = await fetchApp(app.router, "/go?project=work")
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe("/p/work")
  })

  test("the switcher refuses an unknown project", async () => {
    const app = open(twoProjects)
    expect((await fetchApp(app.router, "/go?project=nope")).status).toBe(404)
  })
})
```

A test for the error entry (a project whose `open` fails) needs a source whose `open` layer fails. Add it with a bespoke source in the same file:

```ts
  test("a broken project shows an error entry and the others still render", async () => {
    const broken: AnySource = {
      kind: "broken",
      config: Schema.Struct({}),
      location: () => "broken",
      open: () => Layer.fail(new SourceError({ name: "bad", message: "cannot open" })),
    }
    const app = open({
      projects: [{ name: "acme", fields: { title: "Acme" } }, { name: "bad", source: "broken" }],
      extraSources: [broken],
    })
    const html = await (await fetchApp(app.router, "/")).text()
    expect(html).toContain("Acme")
    expect(html).toContain("cannot open")
    expect(html).toContain('class="project-error')
    expect(html).toContain('action="/p/bad/sync"')
  })
```

with `import { Layer, Schema } from "effect"` and `import { type AnySource, SourceError } from "../../src/hub/index.ts"`.

- [ ] **Step 3: Run them to verify they fail**

Run: `bun test test/web/dashboard.test.ts`
Expected: FAIL — `GET /` has no action.

- [ ] **Step 4: Write the dashboard UI**

`src/web/app/ui/dashboard.tsx`:

```ts
import type { DateTime } from "effect"
import type { TaskView } from "../../../core/index.ts"
import type { Overview, OverviewEntry, OverviewTask, ProjectInfo } from "../../../hub/index.ts"
import { type DashboardQuery, dashboardHref } from "../actions/dashboard/query.ts"
import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"
import { showId } from "./format.ts"
import { syncStatusBadge } from "./status.tsx"

export interface DashboardOptions {
  readonly overview: Overview
  /** Every project, for the filter bar; in registry order, unregistered last. */
  readonly projects: ReadonlyArray<ProjectInfo>
  /** The source kinds the hub loaded, for the filter bar. */
  readonly sources: ReadonlyArray<string>
  readonly query: DashboardQuery
  readonly now: DateTime.Utc
  /** True when some project can sync, which is what makes Sync all worth showing. */
  readonly syncable: boolean
}

const MAX_NEXT = 5

const openTasks = (entry: Extract<OverviewEntry, { listing: unknown }>): ReadonlyArray<TaskView> =>
  entry.listing.sections.flatMap((section) => section.tasks)

const counts = (tasks: ReadonlyArray<TaskView>): string => {
  const ready = tasks.filter((view) => view.state === "ready").length
  const blocked = tasks.length - ready
  return `<span class="counts">${tasks.length} open · ${ready} ready · ${blocked} blocked</span>`
}

const registerForm = (name: string): string =>
  `<form method="post" action="${routes.projects.add.href()}" class="inline"><input type="hidden" name="target" value="${escapeHtml(name)}"><input type="hidden" name="fromProject" value="${escapeHtml(name)}"><button class="secondary" type="submit">Register</button></form>`

const syncForm = (name: string, back: string): string =>
  `<form method="post" action="${routes.project.sync.href({ project: name })}" class="inline"><input type="hidden" name="back" value="${escapeHtml(back)}"><button class="secondary" type="submit">Sync</button></form>`

const projectHeading = (info: ProjectInfo, now: DateTime.Utc, back: string): string =>
  `<div class="project-heading"><h2><a href="${routes.project.board.href({ project: info.name })}">${escapeHtml(info.name)}</a></h2><span class="badge muted">${escapeHtml(info.source)}</span>${
    info.syncable ? syncStatusBadge(info.status, now) : ""
  }${info.registered ? "" : `<span class="badge blocked">not registered</span>${registerForm(info.name)}`}${
    info.syncable ? syncForm(info.name, back) : ""
  }</div>`

const nextRow = (project: string, view: TaskView): string =>
  `<li><code>${escapeHtml(project)}:${showId(view.task.id)}</code> <a href="${routes.project.tasks.show.href({ project, id: view.task.id })}">${escapeHtml(view.task.title)}</a></li>`

const projectSection = (entry: OverviewEntry, now: DateTime.Utc, back: string): string => {
  const heading = projectHeading(entry.project, now, back)
  if (!("listing" in entry)) {
    return `<section class="project project-error">${heading}<p class="badge error">${escapeHtml(entry.error.message)}</p></section>`
  }
  const tasks = openTasks(entry)
  const ready = tasks.filter((view) => view.state === "ready")
  const shown = ready.slice(0, MAX_NEXT)
  const rest = ready.length - shown.length
  const body =
    shown.length === 0
      ? '<p class="empty">Nothing ready.</p>'
      : `<ul class="next-tasks">${shown.map((view) => nextRow(entry.project.name, view)).join("")}</ul>${
          rest === 0
            ? ""
            : `<p class="muted"><a href="${routes.project.board.href({ project: entry.project.name })}">${rest} more</a></p>`
        }`
  return `<section class="project">${heading}${counts(tasks)}${body}</section>`
}

const flatRow = (task: OverviewTask): string =>
  `<article class="task-row"><code>${escapeHtml(task.ref)}</code><div class="task-copy"><a class="task-title" href="${routes.project.tasks.show.href({ project: task.project, id: task.view.task.id })}">${escapeHtml(task.view.task.title)}</a></div><div class="task-meta"><a class="chip" href="${escapeHtml(routes.project.board.href({ project: task.project }))}">${escapeHtml(task.project)}</a> <span class="badge ${task.view.state}">${task.view.state.toUpperCase()}</span></div></article>`

const checkbox = (name: string, value: string, checked: boolean, label: string): string =>
  `<label class="check"><input type="checkbox" name="${name}" value="${escapeHtml(value)}"${checked ? " checked" : ""}> ${escapeHtml(label)}</label>`

const filterBar = (options: DashboardOptions): string => {
  const { query } = options
  const projects = options.projects
    .map((info) => checkbox("project", info.name, query.projects.includes(info.name), info.name))
    .join("")
  const sources = options.sources
    .map((kind) => checkbox("source", kind, query.sources.includes(kind), kind))
    .join("")
  const state = ["", "ready", "blocked"]
    .map(
      (value) =>
        `<option value="${value}"${(query.state ?? "") === value ? " selected" : ""}>${value === "" ? "Any state" : value}</option>`,
    )
    .join("")
  const view = (["projects", "flat"] as const)
    .map(
      (value) =>
        `<option value="${value}"${query.view === value ? " selected" : ""}>${value === "projects" ? "By project" : "Flat"}</option>`,
    )
    .join("")
  return `<form class="filters" method="get" action="${routes.dashboard.href()}"><fieldset><legend>Projects</legend>${projects}</fieldset><fieldset><legend>Sources</legend>${sources}</fieldset><label>Tag <input name="tag" value="${escapeHtml(query.tags.join(" "))}"></label><label>Assignee <input name="assignee" value="${escapeHtml(query.assignee ?? "")}"></label><label>State <select name="state">${state}</select></label><label>View <select name="view">${view}</select></label><button type="submit">Filter</button></form>`
}

/** The dashboard body. `back` is where the sync forms return to. */
export const DashboardPage = (options: DashboardOptions): string => {
  const back = dashboardHref(options.query)
  if (options.projects.length === 0) {
    return `<h1>Projects</h1><p class="empty">No projects yet. <a href="${routes.projects.index.href()}">Add one.</a></p>`
  }
  const syncAll = options.syncable
    ? `<form method="post" action="${routes.sync.href()}" class="inline"><input type="hidden" name="back" value="${escapeHtml(back)}"><button type="submit">Sync all</button></form>`
    : ""
  const body =
    options.query.view === "flat"
      ? options.overview.tasks.length === 0
        ? '<p class="empty">Nothing matches these filters.</p>'
        : options.overview.tasks.map(flatRow).join("")
      : options.overview.projects.length === 0
        ? '<p class="empty">Nothing matches these filters.</p>'
        : options.overview.projects
            .map((entry) => projectSection(entry, options.now, back))
            .join("")
  return `<div class="page-heading"><h1>Projects</h1>${syncAll}</div>${filterBar(options)}${body}`
}
```

The `tag` input takes a space-separated list; `parseDashboardQuery` reads repeated `tag` parameters, so **split it on submit is not possible without JS**. Keep it honest: name the input `tag` and document that it takes one tag; multiple tags come from repeated links on the board. If you want several, the filter bar can render one `tag` input per active tag plus one empty — do that only if a test demands it; the single input is what the tests above assume.

- [ ] **Step 5: Write the controller**

`src/web/app/actions/dashboard/controller.tsx`:

```tsx
/** @jsxImportSource remix/ui */

import { DateTime, Effect } from "effect"
import { redirect } from "remix/response/redirect"
import { createController } from "remix/router"
import { Hub } from "../../../../hub/index.ts"
import type { HubRuntime } from "../../middleware/project.tsx"
import { routes } from "../../routes.ts"
import { DashboardPage } from "../../ui/dashboard.tsx"
import { Document, ErrorPage } from "../../ui/document.tsx"
import { renderPage, scriptEntryOf, takeFlash, type WebContext } from "../page.ts"
import { respondDefect } from "../respond.tsx"
import { InvalidQuery, parseDashboardQuery } from "./query.ts"

const LIVE_EVENTS = ["changed", "synced", "registry"]

const badRequest = (context: WebContext, message: string): Response =>
  renderPage(
    context,
    <ErrorPage status={400} message={message} scriptEntry={scriptEntryOf(context)} />,
    { status: 400 },
  )

const dashboard =
  (options: { readonly runtime: HubRuntime; readonly startup: string }) =>
  async (context: WebContext): Promise<Response> => {
    try {
      let query
      try {
        query = parseDashboardQuery(new URL(context.request.url))
      } catch (error) {
        if (error instanceof InvalidQuery) return badRequest(context, error.message)
        throw error
      }
      const { projects, overview, kinds } = await options.runtime.runPromise(
        Effect.gen(function* () {
          const hub = yield* Hub
          const all = yield* hub.projects()
          // `overview` defaults to registered projects only, so an unregistered
          // startup project is asked for by name (design note 4).
          const startup = all.find((info) => info.name === options.startup)
          const unregisteredStartup =
            startup !== undefined && !startup.registered ? [startup.name] : []
          const wanted =
            query.overview.projects ??
            (unregisteredStartup.length === 0
              ? undefined
              : [
                  ...unregisteredStartup,
                  ...all.filter((info) => info.registered).map((info) => info.name),
                ])
          const view = yield* hub.overview({
            ...query.overview,
            ...(wanted === undefined ? {} : { projects: wanted }),
          })
          return {
            projects: all,
            overview: view,
            kinds: [...new Set(all.map((info) => info.source).filter((kind) => kind !== ""))],
          }
        }),
      )
      const flash = takeFlash(context)
      return renderPage(
        context,
        <Document
          title="todo.md"
          pageTitle="Projects · todo.md"
          content={DashboardPage({
            overview,
            projects,
            sources: kinds,
            query,
            now: DateTime.nowUnsafe(),
            syncable: projects.some((info) => info.syncable),
          })}
          switcher={projects.map((info) => ({
            name: info.name,
            registered: info.registered,
          }))}
          liveEvents={LIVE_EVENTS}
          scriptEntry={scriptEntryOf(context)}
          {...(flash === undefined ? {} : { flash })}
        />,
      )
    } catch (defect) {
      return respondDefect(context, defect)
    }
  }

/** `GET /go?project=`: the switcher without JavaScript. */
const go =
  (options: { readonly runtime: HubRuntime }) =>
  async (context: WebContext): Promise<Response> => {
    try {
      const name = new URL(context.request.url).searchParams.get("project")?.trim() ?? ""
      const known = await options.runtime.runPromise(
        Effect.flatMap(Hub, (hub) => hub.projects()),
      )
      if (!known.some((info) => info.name === name)) {
        return renderPage(
          context,
          <ErrorPage
            status={404}
            message={`No project named ${name}.`}
            scriptEntry={scriptEntryOf(context)}
          />,
          { status: 404 },
        )
      }
      return redirect(routes.project.board.href({ project: name }), 303)
    } catch (defect) {
      return respondDefect(context, defect)
    }
  }

export const createDashboardController = (options: {
  readonly runtime: HubRuntime
  readonly startup: string
}) =>
  createController(routes, {
    actions: { dashboard: dashboard(options), go: go(options) },
  })
```

If `createController(routes, …)` cannot be declared twice (the top controller already maps `routes`), fold `dashboard` and `go` into `createTopController` in `app/actions/controller.tsx` instead and export the two action functions from this file. Check `remix/router`'s `createController` contract before choosing; the rest of the code is identical either way.

- [ ] **Step 6: Map it**

In `src/web/app/router.ts`, add before the `routes` mapping:

```ts
  router.map(routes, createDashboardController({ runtime: options.runtime, startup: options.startup }))
```

(or pass the two actions into `createTopController`, per step 5's note).

- [ ] **Step 7: Style the dashboard**

Append to `src/web/app/ui/styles.css`:

```css
.page-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  align-items: flex-end;
  padding: 14px 0;
  border-bottom: 1px solid var(--hairline);
}
.filters fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 0;
  border: 0;
  padding: 0;
}
.filters legend {
  padding: 0;
  color: var(--muted);
  font-size: 0.8rem;
}
.check {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  font-size: 0.85rem;
}
.project {
  padding: 18px 0;
  border-bottom: 1px solid var(--hairline);
}
.project-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}
.project-heading h2 {
  margin: 0;
}
.counts {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 0.85rem;
}
.next-tasks {
  margin: 8px 0 0;
  padding-left: 0;
  list-style: none;
}
.next-tasks li {
  display: flex;
  gap: 8px;
  padding: 3px 0;
}
.inline {
  display: inline;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/web/app/ui/dashboard.tsx src/web/app/actions/dashboard src/web/app/router.ts src/web/app/ui/styles.css test/web/harness.ts test/web/dashboard.test.ts
git commit -m "feat(web): add the cross-project dashboard"
```

---

## Task 7: The projects page and adding a project

**Files:**
- Create: `src/web/app/ui/projects.tsx`, `src/web/app/actions/projects/controller.tsx`, `test/web/projects.test.ts`
- Modify: `src/web/app/router.ts`, `src/web/app/actions/forms.ts`, `src/web/app/ui/styles.css`

**Interfaces:**
- Consumes: `projectInput` from `hub`; `syncStatusBadge` (Task 5); `hubBack`.
- Produces: `ProjectsPage(options: ProjectsOptions): string`, `createProjectsController({ runtime })`, `parseProjectForm(form)`, `hubBack(value, fallback)`.

- [ ] **Step 1: Write the failing tests**

`test/web/projects.test.ts` (same `cleanup`/`open`/`fetchApp` preamble as `dashboard.test.ts`, plus a `postApp` helper):

```ts
const postApp = (
  router: ReturnType<typeof makeRouter>["router"],
  path: string,
  fields: Record<string, string>,
) => {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.append(key, value)
  return router.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { Host: "localhost", Origin: "http://localhost" },
      body,
    }),
  )
}

describe("projects page", () => {
  test("lists every project with its source, location and status", async () => {
    const app = open({
      projects: [
        { name: "acme", fields: { title: "Acme" } },
        { name: "work", fields: { title: "Work" } },
      ],
    })
    const html = await (await fetchApp(app.router, "/projects")).text()
    expect(html).toContain("acme")
    expect(html).toContain("work")
    expect(html).toContain("memory")
    expect(html).toContain("never synced")
    expect(html).toContain('action="/projects"')
    expect(html).toContain('data-live-events="registry synced"')
  })

  test("adds a project and redirects to its board", async () => {
    const app = open()
    const dir = mkdtempSync(join(tmpdir(), "todo-md-add-"))
    writeFileSync(join(dir, "TODO.md"), "# New\n\n- [ ] First\n")
    const response = await postApp(app.router, "/projects", { target: dir, name: "new" })
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe("/p/new")
    const listed = await (await fetchApp(app.router, "/projects")).text()
    expect(listed).toContain("new")
  })

  test("a duplicate name re-renders the form with 422", async () => {
    const app = open()
    const dir = mkdtempSync(join(tmpdir(), "todo-md-add-"))
    writeFileSync(join(dir, "TODO.md"), "# Dup\n")
    const response = await postApp(app.router, "/projects", { target: dir, name: "acme" })
    expect(response.status).toBe(422)
    const html = await response.text()
    expect(html).toContain("already exists")
    expect(html).toContain(`value="${dir}"`)
  })

  test("a missing target is rejected without touching the registry", async () => {
    const app = open()
    const response = await postApp(app.router, "/projects", { target: "", name: "x" })
    expect(response.status).toBe(422)
    expect(await response.text()).toContain("A path or URL is required")
  })
})
```

with `import { mkdtempSync, writeFileSync } from "node:fs"`, `import { tmpdir } from "node:os"`, `import { join } from "node:path"`, and `fsSource` added to the hub's sources — extend `MakeHubOptions.extraSources` with `[fsSource]` in the two `open(...)` calls that add a real directory.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test test/web/projects.test.ts`
Expected: FAIL — `/projects` 404s.

- [ ] **Step 3: Add the form parser and `hubBack`**

In `src/web/app/actions/forms.ts`:

```ts
/** The add-a-project form: a path or URL, an optional name and a source kind. */
export const parseProjectForm = (form: FormData) => {
  const target = value(form, "target")
  const name = value(form, "name")
  const source = value(form, "source")
  return {
    target,
    name,
    source: source === "" || source === "infer" ? undefined : source,
    issues: target === "" ? ["A path or URL is required"] : [],
  }
}

export type ProjectValues = ReturnType<typeof parseProjectForm>

/** `localBack` for hub routes, which have no project to fall back to. */
export const hubBack = (value_: string | undefined, fallback: string): string =>
  value_?.startsWith("/") &&
  !value_.startsWith("//") &&
  !value_.includes("\\") &&
  ![...value_].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
    ? value_
    : fallback
```

Refactor `localBack` to delegate: `export const localBack = (value_, project) => hubBack(value_, routes.project.board.href({ project }))`. Keep its tests green.

- [ ] **Step 4: Write the projects UI**

`src/web/app/ui/projects.tsx`:

```ts
import type { DateTime } from "effect"
import type { ProjectInfo } from "../../../hub/index.ts"
import type { ProjectValues } from "../actions/forms.ts"
import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"
import { syncStatusBadge } from "./status.tsx"

export interface ProjectsOptions {
  readonly projects: ReadonlyArray<ProjectInfo>
  /** The kinds the hub loaded, for the add form's source select. */
  readonly sources: ReadonlyArray<string>
  readonly now: DateTime.Utc
  readonly values?: ProjectValues
  readonly issues?: ReadonlyArray<string>
  /** A project whose removal the source refused, with the reason. */
  readonly refusal?: { readonly name: string; readonly message: string }
  /** The project whose inline rename form is open. */
  readonly renaming?: string
}

const row = (info: ProjectInfo, now: DateTime.Utc, renaming: string | undefined): string => {
  const name = escapeHtml(info.name)
  const rename =
    renaming === info.name
      ? `<form method="post" action="${routes.projects.rename.href({ name: info.name })}" class="inline"><input name="to" value="${name}" aria-label="New name for ${name}" required><button type="submit">Save</button></form>`
      : `<a class="secondary" href="${routes.projects.index.href()}?rename=${encodeURIComponent(info.name)}">Rename</a>`
  const sync = info.syncable
    ? `<form method="post" action="${routes.project.sync.href({ project: info.name })}" class="inline"><input type="hidden" name="back" value="${routes.projects.index.href()}"><button class="secondary" type="submit">Sync</button></form>`
    : ""
  return `<tr><td><a href="${routes.project.board.href({ project: info.name })}">${name}</a>${info.registered ? "" : ' <span class="badge blocked">not registered</span>'}</td><td><span class="badge muted">${escapeHtml(info.source)}</span></td><td><code>${escapeHtml(info.location)}</code></td><td>${info.syncable ? syncStatusBadge(info.status, now) : '<span class="muted">—</span>'}</td><td class="row-actions">${sync}${rename}<form method="post" action="${routes.projects.remove.href({ name: info.name })}" class="inline"><button class="secondary danger" type="submit">Remove</button></form></td></tr>`
}

const addForm = (options: ProjectsOptions): string => {
  const values = options.values ?? { target: "", name: "", source: undefined, issues: [] }
  const issues = options.issues ?? []
  const sources = ["infer", ...options.sources]
    .map(
      (kind) =>
        `<option value="${kind}"${(values.source ?? "infer") === kind ? " selected" : ""}>${kind}</option>`,
    )
    .join("")
  return `<section class="add-project"><h2>Add a project</h2>${
    issues.length === 0
      ? ""
      : `<ul class="issues">${issues.map((issue) => `<li class="badge error">${escapeHtml(issue)}</li>`).join("")}</ul>`
  }<form method="post" action="${routes.projects.add.href()}"><label>Target <input name="target" value="${escapeHtml(values.target)}" placeholder="~/labs/acme or https://github.com/owner/repo.git" required></label><label>Name <input name="name" value="${escapeHtml(values.name)}" placeholder="optional"></label><label>Source <select name="source">${sources}</select></label><button type="submit">Add</button></form></section>`
}

const refusal = (options: ProjectsOptions): string => {
  if (options.refusal === undefined) return ""
  const { name, message } = options.refusal
  return `<section class="project-error"><p class="badge error">${escapeHtml(message)}</p><form method="post" action="${routes.projects.remove.href({ name })}" class="inline"><input type="hidden" name="force" value="1"><button class="secondary danger" type="submit">Remove anyway</button></form></section>`
}

export const ProjectsPage = (options: ProjectsOptions): string => {
  const rows = options.projects
    .map((info) => row(info, options.now, options.renaming))
    .join("")
  const table =
    options.projects.length === 0
      ? '<p class="empty">No projects yet. Add one below.</p>'
      : `<table class="projects"><thead><tr><th>Name</th><th>Source</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`
  return `<h1>Projects</h1>${refusal(options)}${table}${addForm(options)}`
}
```

- [ ] **Step 5: Write the controller (index + add)**

`src/web/app/actions/projects/controller.tsx`:

```tsx
/** @jsxImportSource remix/ui */

import { DateTime, Effect, Result } from "effect"
import { redirect } from "remix/response/redirect"
import { createController } from "remix/router"
import { Hub, projectInput } from "../../../../hub/index.ts"
import type { HubRuntime } from "../../middleware/project.tsx"
import { routes } from "../../routes.ts"
import { Document } from "../../ui/document.tsx"
import { ProjectsPage, type ProjectsOptions } from "../../ui/projects.tsx"
import { parseProjectForm } from "../forms.ts"
import { renderPage, scriptEntryOf, setFlash, takeFlash, type WebContext } from "../page.ts"
import { respondDefect } from "../respond.tsx"

const LIVE_EVENTS = ["registry", "synced"]

const renderProjects = async (
  runtime: HubRuntime,
  context: WebContext,
  extra: Omit<ProjectsOptions, "projects" | "sources" | "now"> = {},
  status = 200,
): Promise<Response> => {
  const projects = await runtime.runPromise(Effect.flatMap(Hub, (hub) => hub.projects()))
  const flash = takeFlash(context)
  return renderPage(
    context,
    <Document
      title="todo.md"
      pageTitle="Projects · todo.md"
      content={ProjectsPage({
        projects,
        sources: [...new Set(projects.map((info) => info.source).filter((kind) => kind !== ""))],
        now: DateTime.nowUnsafe(),
        ...extra,
      })}
      switcher={projects.map((info) => ({ name: info.name, registered: info.registered }))}
      liveEvents={LIVE_EVENTS}
      scriptEntry={scriptEntryOf(context)}
      {...(flash === undefined ? {} : { flash })}
    />,
    { status },
  )
}

export const createProjectsController = (options: { readonly runtime: HubRuntime }) =>
  createController(routes.projects, {
    actions: {
      index: async (context) => {
        try {
          const renaming = new URL(context.request.url).searchParams.get("rename") ?? undefined
          return await renderProjects(
            options.runtime,
            context as WebContext,
            renaming === undefined ? {} : { renaming },
          )
        } catch (defect) {
          return respondDefect(context as WebContext, defect)
        }
      },

      add: async (context) => {
        try {
          const web = context as WebContext
          const values = parseProjectForm(context.get(FormData) as FormData)
          if (values.issues.length > 0) {
            return await renderProjects(options.runtime, web, { values, issues: values.issues }, 422)
          }
          const result = await options.runtime.runPromise(
            Effect.result(
              Effect.gen(function* () {
                const hub = yield* Hub
                const input = yield* projectInput(values.target, {
                  // The server's cwd is the only sensible base for a relative path.
                  cwd: "",
                  ...(values.source === undefined ? {} : { source: values.source }),
                  ...(values.name === "" ? {} : { name: values.name }),
                })
                return yield* hub.add(input)
              }),
            ),
          )
          if (Result.isFailure(result)) {
            return await renderProjects(
              options.runtime,
              web,
              { values, issues: [result.failure.message] },
              422,
            )
          }
          setFlash(web, { message: `Added project ${result.success.name}.`, tone: "info" })
          return redirect(routes.project.board.href({ project: result.success.name }), 303)
        } catch (defect) {
          return respondDefect(context as WebContext, defect)
        }
      },
    },
  })
```

`rename` and `remove` are added in Task 8; if `createController` requires every action up front, add them here as stubs returning `redirect(routes.projects.index.href(), 303)` and replace them in Task 8 — but only if the type demands it.

The dashboard's **Register** button posts `target=<name>` to `/projects`. That is wrong for an unregistered project, whose target is its *list path*, not its name. Fix it here: `registerForm` in `dashboard.tsx` must send the project's `location` (which for an unregistered fs project is its list path) as `target` and its `name` as `name`:

```ts
const registerForm = (info: ProjectInfo): string =>
  `<form method="post" action="${routes.projects.add.href()}" class="inline"><input type="hidden" name="target" value="${escapeHtml(info.location)}"><input type="hidden" name="name" value="${escapeHtml(info.name)}"><input type="hidden" name="source" value="${escapeHtml(info.source)}"><button class="secondary" type="submit">Register</button></form>`
```

Update `projectHeading` to pass `info` and adjust Task 6's call site.

- [ ] **Step 6: Map it and style the table**

In `src/web/app/router.ts`:

```ts
  router.map(routes.projects, createProjectsController({ runtime: options.runtime }))
```

before the `routes` mapping. Append to `styles.css`:

```css
.projects {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.projects th,
.projects td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--hairline);
  text-align: left;
  vertical-align: top;
}
.projects th {
  color: var(--muted);
  font-weight: 400;
  font-size: 0.8rem;
}
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.add-project label {
  display: block;
  margin: 8px 0;
}
.issues {
  margin: 8px 0;
  padding-left: 0;
  list-style: none;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/web/app/ui/projects.tsx src/web/app/ui/dashboard.tsx src/web/app/actions/projects src/web/app/actions/forms.ts src/web/app/router.ts src/web/app/ui/styles.css test/web/projects.test.ts
git commit -m "feat(web): add the projects page and adding a project"
```

---

## Task 8: Renaming and removing projects

**Files:**
- Modify: `src/web/app/actions/projects/controller.tsx`
- Test: `test/web/projects.test.ts`

**Interfaces:**
- Consumes: `hub.rename`, `hub.remove(name, { force })`, `renderProjects` (Task 7).

- [ ] **Step 1: Write the failing tests**

Append to `test/web/projects.test.ts`:

```ts
  test("renames a project and flashes the result", async () => {
    const app = open()
    const response = await postApp(app.router, "/projects/acme/rename", { to: "acme2" })
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe("/projects")
    const html = await (
      await app.router.fetch(
        new Request("http://localhost/projects", {
          headers: { Host: "localhost", Cookie: required(response.headers.get("Set-Cookie")) },
        }),
      )
    ).text()
    expect(html).toContain("acme2")
    expect(html).toContain("Renamed acme to acme2")
  })

  test("an invalid new name re-renders with 422", async () => {
    const app = open()
    const response = await postApp(app.router, "/projects/acme/rename", { to: "Not A Name" })
    expect(response.status).toBe(422)
    expect(await response.text()).toContain("invalid project name")
  })

  test("removes a project", async () => {
    const app = open({
      projects: [
        { name: "acme", fields: { title: "Acme" } },
        { name: "work", fields: { title: "Work" } },
      ],
    })
    const response = await postApp(app.router, "/projects/work/remove", {})
    expect(response.status).toBe(303)
    const html = await (await fetchApp(app.router, "/projects")).text()
    expect(html).not.toContain(">work<")
  })

  test("a refused removal offers Remove anyway, and force works", async () => {
    const refuses = memorySource({
      kind: "refuses",
      beforeRemove: (project, force) =>
        force
          ? Effect.void
          : Effect.fail(
              new SourceError({ name: project.name, message: "1 unpushed commit" }),
            ),
    })
    const app = open({
      projects: [
        { name: "acme", fields: { title: "Acme" } },
        { name: "stub", source: "refuses" },
      ],
      extraSources: [refuses],
    })
    const refused = await postApp(app.router, "/projects/stub/remove", {})
    expect(refused.status).toBe(422)
    const html = await refused.text()
    expect(html).toContain("1 unpushed commit")
    expect(html).toContain("Remove anyway")
    expect(html).toContain('name="force"')

    const forced = await postApp(app.router, "/projects/stub/remove", { force: "1" })
    expect(forced.status).toBe(303)
    expect(await (await fetchApp(app.router, "/projects")).text()).not.toContain(">stub<")
  })
```

with `import { Effect } from "effect"`, `import { SourceError } from "../../src/hub/index.ts"`, `import { memorySource } from "../../src/hub/testing.ts"`, and the `required` helper copied from `test/web/contracts.test.ts:34`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test test/web/projects.test.ts`
Expected: FAIL — the rename and remove routes 404 (or redirect from the stubs).

- [ ] **Step 3: Implement the two actions**

In `src/web/app/actions/projects/controller.tsx`, add to `actions`:

```tsx
      rename: async (context) => {
        try {
          const web = context as WebContext
          const from = String(web.params.name ?? "")
          const to = String((context.get(FormData) as FormData).get("to") ?? "").trim()
          if (to === "") {
            return await renderProjects(
              options.runtime,
              web,
              { issues: ["A new name is required"], renaming: from },
              422,
            )
          }
          const result = await options.runtime.runPromise(
            Effect.result(Effect.flatMap(Hub, (hub) => hub.rename(from, to))),
          )
          if (Result.isFailure(result)) {
            return await renderProjects(
              options.runtime,
              web,
              { issues: [result.failure.message], renaming: from },
              422,
            )
          }
          setFlash(web, { message: `Renamed ${from} to ${to}.`, tone: "info" })
          return redirect(routes.projects.index.href(), 303)
        } catch (defect) {
          return respondDefect(context as WebContext, defect)
        }
      },

      remove: async (context) => {
        try {
          const web = context as WebContext
          const name = String(web.params.name ?? "")
          const force = String((context.get(FormData) as FormData).get("force") ?? "") !== ""
          const result = await options.runtime.runPromise(
            Effect.result(Effect.flatMap(Hub, (hub) => hub.remove(name, { force }))),
          )
          if (Result.isFailure(result)) {
            const error = result.failure
            // A source refusing (e.g. unpushed commits) is answerable: offer force.
            if (error._tag === "SourceError") {
              return await renderProjects(
                options.runtime,
                web,
                { refusal: { name, message: error.message } },
                422,
              )
            }
            return await renderProjects(options.runtime, web, { issues: [error.message] }, 422)
          }
          setFlash(web, { message: `Removed project ${name}.`, tone: "info" })
          return redirect(routes.projects.index.href(), 303)
        } catch (defect) {
          return respondDefect(context as WebContext, defect)
        }
      },
```

`web.params` is `Record<string, string>` on `WebContext`, the same access `loadProject` uses (`src/web/app/middleware/project.tsx:31`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/app/actions/projects/controller.tsx test/web/projects.test.ts
git commit -m "feat(web): rename and remove projects from the browser"
```

---

## Task 9: Sync from the browser

**Files:**
- Create: `src/web/app/actions/sync/controller.tsx`, `test/web/sync.test.ts`
- Modify: `src/web/app/router.ts`, `src/web/app/actions/controller.tsx`

**Interfaces:**
- Consumes: `hub.sync`, `hub.syncAll`, `SyncResult`, `SyncFailure`, `hubBack` (Task 7).
- Produces: `syncSummary(outcomes: ReadonlyArray<SyncResult | SyncFailure>): string`, `createSyncController({ runtime })`, `createProjectSyncController({ runtime })`.

- [ ] **Step 1: Write the failing tests**

`test/web/sync.test.ts` (same preamble plus `postApp`):

```ts
const syncing = (summary: string) =>
  memorySource({
    kind: "syncs",
    sync: () => Effect.succeed({ summary }),
  })

const failing = memorySource({
  kind: "fails",
  sync: (project) =>
    Effect.fail(new SyncError({ name: project.name, reason: "auth", message: "auth failed" })),
})

describe("sync", () => {
  test("POST /sync syncs everything and flashes a summary", async () => {
    const app = open({
      projects: [{ name: "ok", source: "syncs" }, { name: "bad", source: "fails" }],
      extraSources: [syncing("pulled 3 commits"), failing],
    })
    const response = await postApp(app.router, "/sync", { back: "/" })
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe("/")
    const html = await (
      await app.router.fetch(
        new Request("http://localhost/", {
          headers: { Host: "localhost", Cookie: required(response.headers.get("Set-Cookie")) },
        }),
      )
    ).text()
    expect(html).toContain("1 synced, 1 failed: bad (auth)")
  })

  test("POST /p/:project/sync reports one project", async () => {
    const app = open({
      projects: [{ name: "ok", source: "syncs" }],
      extraSources: [syncing("pulled 3 commits")],
    })
    const response = await postApp(app.router, "/p/ok/sync", { back: "/projects" })
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe("/projects")
    const html = await (
      await app.router.fetch(
        new Request("http://localhost/projects", {
          headers: { Host: "localhost", Cookie: required(response.headers.get("Set-Cookie")) },
        }),
      )
    ).text()
    expect(html).toContain("ok: pulled 3 commits")
  })

  test("a failing project's reason reaches the flash", async () => {
    const app = open({ projects: [{ name: "bad", source: "fails" }], extraSources: [failing] })
    const response = await postApp(app.router, "/p/bad/sync", {})
    const html = await (
      await app.router.fetch(
        new Request("http://localhost/", {
          headers: { Host: "localhost", Cookie: required(response.headers.get("Set-Cookie")) },
        }),
      )
    ).text()
    expect(html).toContain("auth failed")
    expect(html).toContain("flash error")
    expect(response.status).toBe(303)
  })

  test("an off-site back value falls back to the dashboard", async () => {
    const app = open({ projects: [{ name: "ok", source: "syncs" }], extraSources: [syncing("ok")] })
    const response = await postApp(app.router, "/sync", { back: "//evil.example" })
    expect(response.headers.get("Location")).toBe("/")
  })
})
```

with `import { SyncError } from "../../src/hub/index.ts"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test test/web/sync.test.ts`
Expected: FAIL — neither sync route exists.

- [ ] **Step 3: Write the controller**

`src/web/app/actions/sync/controller.tsx`:

```tsx
/** @jsxImportSource remix/ui */

import { Effect, Result } from "effect"
import { redirect } from "remix/response/redirect"
import { createController } from "remix/router"
import { Hub, type SyncFailure, type SyncResult } from "../../../../hub/index.ts"
import type { HubRuntime } from "../../middleware/project.tsx"
import { routes } from "../../routes.ts"
import { hubBack } from "../forms.ts"
import { setFlash, type WebContext } from "../page.ts"
import { respondDefect } from "../respond.tsx"

/** `2 synced, 1 failed: work (auth)`, or `everything is up to date`. */
export const syncSummary = (outcomes: ReadonlyArray<SyncResult | SyncFailure>): string => {
  const failures = outcomes.filter((outcome): outcome is SyncFailure => "error" in outcome)
  const synced = outcomes.length - failures.length
  if (outcomes.length === 0) return "Nothing to sync."
  if (failures.length === 0) return `${synced} synced.`
  const named = failures
    .map((failure) => `${failure.project} (${failure.error.reason})`)
    .join(", ")
  return `${synced} synced, ${failures.length} failed: ${named}`
}

const backOf = (context: WebContext, fallback: string): string =>
  hubBack(String((context.get(FormData) as FormData).get("back") ?? ""), fallback)

export const createSyncController = (options: { readonly runtime: HubRuntime }) =>
  createController(routes, {
    actions: {
      sync: async (context) => {
        try {
          const web = context as WebContext
          const back = backOf(web, routes.dashboard.href())
          const outcomes = await options.runtime.runPromise(
            Effect.flatMap(Hub, (hub) => hub.syncAll()),
          )
          const failed = outcomes.some((outcome) => "error" in outcome)
          setFlash(web, {
            message: syncSummary(outcomes),
            tone: failed ? "error" : "info",
          })
          return redirect(back, 303)
        } catch (defect) {
          return respondDefect(context as WebContext, defect)
        }
      },
    },
  })

export const createProjectSyncController = (options: { readonly runtime: HubRuntime }) =>
  createController(routes.project, {
    actions: {
      sync: async (context) => {
        try {
          const web = context as WebContext
          const name = String(web.params.project ?? "")
          const back = backOf(web, routes.dashboard.href())
          const result = await options.runtime.runPromise(
            Effect.result(Effect.flatMap(Hub, (hub) => hub.sync(name))),
          )
          setFlash(
            web,
            Result.isFailure(result)
              ? { message: `${name}: ${result.failure.message}`, tone: "error" }
              : { message: `${name}: ${result.success.summary}`, tone: "info" },
          )
          return redirect(back, 303)
        } catch (defect) {
          return respondDefect(context as WebContext, defect)
        }
      },
    },
  })
```

`POST /p/:project/sync` deliberately does **not** run `loadProject`: it needs only the name, and a project whose store cannot open must still be syncable (that is how you fix it). This is why it is its own controller rather than an action on `createRootController`.

The dashboard test expects `1 synced, 1 failed: bad (auth)` — `syncSummary` must produce exactly that string; keep the test and the function in step.

- [ ] **Step 4: Map it**

In `src/web/app/router.ts`, before the other `routes` mapping:

```ts
  router.map(routes.project, createProjectSyncController({ runtime: options.runtime }))
  router.map(routes, createSyncController({ runtime: options.runtime }))
```

Check whether `createController(routes.project, …)` can be mapped twice (the root controller already maps it). If not, move the `sync` action into `createRootController`'s `actions` and give `loadProject` a bypass for it — prefer keeping the separate controller and, if the router forbids it, declare `routes.project.sync` at the top level as `sync: post("/p/:project/sync")` instead. Verify with `bun test test/web/router.test.ts` before choosing.

- [ ] **Step 5: Show the status on the board header**

In `src/web/app/actions/controller.tsx`'s `renderBoard`, pass the project's status into the page so a syncable project shows its badge and a **Sync** button on its own board. Fetch it alongside the listing:

```ts
    const info = await runtimeContext /* hub */ …
```

Do this only if it is cheap: `loadProject` already put `ProjectInfo` on the context, so add to `page.ts`

```ts
export const projectInfoOf = (context: WebContext): ProjectInfo =>
  (context as { readonly get: (key: typeof projectInfoContext) => ProjectInfo }).get(
    projectInfoContext,
  )
```

and in `BoardPage`'s options add `status?: string` rendered next to the title with `syncStatusBadge(info.status, DateTime.nowUnsafe())` plus the same `syncForm`. Add one assertion to `test/web/contracts.test.ts`'s board contract that a non-syncable project shows **no** sync button, so the default stays quiet.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/app/actions/sync src/web/app/actions/controller.tsx src/web/app/router.ts src/web/app/ui/board.tsx src/web/app/actions/page.ts test/web/sync.test.ts test/web/contracts.test.ts
git commit -m "feat(web): sync projects from the browser"
```

---

## Task 10: Live refresh for the hub pages

Design note 6.

**Files:**
- Modify: `src/web/app/actions/public/refresh.ts`, `src/web/app/actions/public/entry.ts`
- Test: `src/web/app/actions/public/refresh.test.ts`, `test/web/events.test.ts`

**Interfaces:**
- Produces: `shouldRefresh(region: LiveRegion, event: LiveEvent): boolean` and `interface LiveRegion { project: string | null; events: ReadonlyArray<string> }`, `interface LiveEvent { kind: string; project?: string }`.

- [ ] **Step 1: Write the failing test**

Append to `src/web/app/actions/public/refresh.test.ts`:

```ts
test("a project page refreshes only on its own project's events", () => {
  const region = { project: "acme", events: [] as ReadonlyArray<string> }
  expect(shouldRefresh(region, { kind: "changed", project: "acme" })).toBe(true)
  expect(shouldRefresh(region, { kind: "synced", project: "acme" })).toBe(true)
  expect(shouldRefresh(region, { kind: "changed", project: "work" })).toBe(false)
  expect(shouldRefresh(region, { kind: "registry" })).toBe(false)
})

test("a hub page refreshes on the event kinds it declares, from any project", () => {
  const dashboard = { project: null, events: ["changed", "synced", "registry"] }
  expect(shouldRefresh(dashboard, { kind: "changed", project: "work" })).toBe(true)
  expect(shouldRefresh(dashboard, { kind: "registry" })).toBe(true)

  const projects = { project: null, events: ["registry", "synced"] }
  expect(shouldRefresh(projects, { kind: "registry" })).toBe(true)
  expect(shouldRefresh(projects, { kind: "synced", project: "work" })).toBe(true)
  expect(shouldRefresh(projects, { kind: "changed", project: "work" })).toBe(false)
})

test("a page with neither a project nor an event list never refreshes", () => {
  expect(shouldRefresh({ project: null, events: [] }, { kind: "changed", project: "x" })).toBe(false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/web/app/actions/public/refresh.test.ts`
Expected: FAIL — `shouldRefresh` is not exported.

- [ ] **Step 3: Implement it**

Append to `src/web/app/actions/public/refresh.ts`:

```ts
/** What a page's live region listens to. */
export interface LiveRegion {
  /** The page's project, or `null` on a hub page. */
  readonly project: string | null
  /** The hub event kinds a hub page listens to; empty on a project page. */
  readonly events: ReadonlyArray<string>
}

export interface LiveEvent {
  readonly kind: string
  readonly project?: string
}

/**
 * A hub page refreshes on the kinds it declares, whatever project they name; a
 * project page refreshes only on its own project's events.
 */
export const shouldRefresh = (region: LiveRegion, event: LiveEvent): boolean =>
  region.events.length > 0
    ? region.events.includes(event.kind)
    : region.project !== null && event.project === region.project
```

- [ ] **Step 4: Use it in the entry script**

In `src/web/app/actions/public/entry.ts`, replace the body of `onChange` up to the `refreshDecision` call:

```ts
  const onChange = async (event: MessageEvent) => {
    const page = document.querySelector("[data-live-region]")
    if (page === null) return
    const region = {
      project: page.getAttribute("data-project"),
      events: (page.getAttribute("data-live-events") ?? "").split(" ").filter(Boolean),
    }
    let payload: { readonly project?: string } = {}
    try {
      payload = JSON.parse(event.data)
    } catch {
      // Malformed payloads are treated as "not for this page".
    }
    if (!shouldRefresh(region, { kind: event.type, ...payload })) return
    if (refreshDecision(dirty) === "notice") {
      document.querySelector("[data-reload-notice]")?.removeAttribute("hidden")
      return
    }
    …unchanged from here…
  }
  events.addEventListener("changed", onChange)
  events.addEventListener("synced", onChange)
  events.addEventListener("registry", onChange)
```

`event.type` is the SSE event name the server sends (`src/web/app/actions/controller.tsx`'s `send`), so it is already `changed`/`synced`/`registry`. Import `shouldRefresh` alongside `refreshDecision`.

Also add submit-on-change for the switcher, after `startLiveRefresh`'s listeners:

```ts
  document.addEventListener("change", (event) => {
    const target = event.target
    if (target instanceof HTMLSelectElement && target.hasAttribute("data-submit-on-change")) {
      target.form?.submit()
    }
  })
```

A select that submits its own GET form must not mark the page dirty — the existing `change` capture listener runs first and sets `dirty`, but the navigation replaces the page anyway, so no extra handling is needed.

- [ ] **Step 5: Assert the dashboard's region in a router test**

Append to `test/web/dashboard.test.ts`:

```ts
  test("the dashboard's live region listens to every hub event", async () => {
    const app = open()
    const html = await (await fetchApp(app.router, "/")).text()
    expect(html).toContain('data-live-events="changed synced registry"')
    expect(html).not.toContain("data-project")
  })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/app/actions/public test/web/dashboard.test.ts
git commit -m "feat(web): refresh the hub pages live"
```

---

## Task 11: Security coverage, docs and closing the task

**Files:**
- Modify: `test/web/security.test.ts`, `src/web/README.md`, `docs/architecture/frontends.md`, `README.md`, `todo/TODO.md`

- [ ] **Step 1: Cover the new POST routes with the cross-origin test**

In `test/web/security.test.ts`, turn `rejects cross-origin POSTs` into a loop over every POST route:

```ts
test("rejects cross-origin POSTs on every route", async () => {
  const { router, project, close } = makeRouter()
  try {
    for (const path of [
      `/p/${project}/tasks`,
      `/p/${project}/sync`,
      "/sync",
      "/projects",
      "/projects/acme/rename",
      "/projects/acme/remove",
    ]) {
      const response = await router.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { Host: "localhost", Origin: "http://foreign.example" },
          body: new FormData(),
        }),
      )
      expect(response.status).toBe(403)
    }
  } finally {
    await close()
  }
})
```

and extend the foreign-host test's path list with `"/"`, `"/projects"` and `"/go?project=acme"`.

- [ ] **Step 2: Run it to verify it passes**

Run: `bun test test/web/security.test.ts`
Expected: PASS — `cop()` is a global middleware, so this is a regression guard rather than new behavior. If any route passes, that route is mapped outside the global middleware chain; fix the router, not the test.

- [ ] **Step 3: Update `src/web/README.md`**

Replace the routes table with one that lists every route:

```markdown
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
```

Add a short "Live refresh" paragraph: a page's `<main>` declares either `data-project` (its own project's `changed`/`synced`) or `data-live-events` (hub event kinds); `shouldRefresh` in `app/actions/public/refresh.ts` is the rule, and a dirty form downgrades a refresh to a notice.

- [ ] **Step 4: Update the architecture and root docs**

In `docs/architecture/frontends.md`, delete the "Planned (tasks 17, 18)" note and describe the two frontends as they now are: the CLI and a web app that serves every registered project, manages the registry, and shares `statusText` with the CLI.

In the root `README.md`, extend "Using the web app": `todo web` opens the startup project's board; `/` is the dashboard over every registered project; projects can be added, renamed, removed and synced from the browser; it stays bound to localhost with a Host allowlist and cross-origin POST rejection, which is what makes registry management from a browser acceptable.

- [ ] **Step 5: Run the full gate**

Run: `bun run check`
Expected: PASS. Then run the app by hand once and click through it:

```bash
bun src/cli/bin.ts web --dir todo
```

Check by hand, with JavaScript disabled in the browser: the dashboard renders, each filter narrows it, the view toggle works, the switcher navigates, `/projects` adds and renames a project, and **Sync all** is absent (no syncable source is registered yet — that is correct until task 19 adds git).

- [ ] **Step 6: Close the task**

```bash
bun src/cli/bin.ts done 18
```

- [ ] **Step 7: Commit**

```bash
git add test/web/security.test.ts src/web/README.md docs/architecture/frontends.md README.md todo/TODO.md
git commit -m "docs(web): document the dashboard and project management"
```

---

## Self-review

**Spec coverage.** Every line of task 18's Design maps to a task: dashboard query parameters and 400s → 4 and 6; `view=projects` sections with name, source badge, sync status, counts and five next tasks → 6; error entries with a Sync button → 6; `view=flat` → 6; the filter bar as a GET form → 6; **Sync all** shown only when something is syncable → 6; the empty-registry sentence and the unregistered startup project with **Register** → 6 and 7; the `/projects` table, add/rename/remove and their status codes → 7 and 8; `POST /sync` and `POST /p/:project/sync` with `back` and flash summaries → 9; the header switcher → 3 and 10; live refresh with the dirty-form rule → 10; the security test → 11; the docs → 11. Task 18's "From task 14's review" question → 2.

**Open risks the executor must confirm in the first task that touches them.**

1. `createController` may not accept the same route group twice (`routes` is mapped by both the top controller and the dashboard controller; `routes.project` by both the root and the sync controller). Tasks 6 and 9 each name the fallback: fold the actions into the existing controller. Verify before writing the second controller.
2. `context.get(key)` for an unset context key may throw or return `undefined`; `currentProject` (Task 3) handles both, but confirm which so the `catch` is not dead code that the linter rejects.
3. The filter bar's single `tag` input cannot produce repeated `tag` parameters without JavaScript (Task 6, step 4). The parser accepts repeats — links on the board produce them — but the bar itself filters by one tag. If that is unacceptable, render one input per active tag plus one empty; decide before writing `filterBar`, not after.
