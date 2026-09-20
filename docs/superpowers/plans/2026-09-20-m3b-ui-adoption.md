# M3b UI Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete milestone M3b (Task 33) by adopting `@lemol/ui`'s `Toaster`, `CommandPalette`, `LiveForm`, `Table` with sorting, and the remove-task confirmation dialog into `src/web`.

**Architecture:** Server-rendered Remix JSX nodes styled via `miniTheme` + `ThemeStyle`, enhanced progressively in the browser using `@lemol/ui/remix/runtime`'s delegated `command` and `input` listeners, with no-JS fallback guarantees across all pages.

**Tech Stack:** Bun, Remix 3, `@lemol/ui` (`mini` + `remix` components + `runtime`), Effect 4.

**Spec:** [`docs/superpowers/specs/2026-09-20-m3b-ui-adoption-design.md`](docs/superpowers/specs/2026-09-20-m3b-ui-adoption-design.md)

## Global Constraints

- Modules import each other through relative paths, never `@lemol/todo-md/...`.
- `AGENTS.md` rule: Only `src/web` may depend on `@lemol/ui`. `boundaries.test.ts` enforces this.
- Forms submit via POST/303 and remain functional without JavaScript.
- All tests use `bun:test`. Every change must pass `bun run check`.

---

### Task 1: Client Runtime Wiring & Toaster for Flash Messages

**Files:**
- Modify: `src/web/app/actions/public/entry.ts:1-20`
- Modify: `src/web/app/ui/document.tsx:200-248`
- Modify: `test/web/ui.test.tsx:130-141`
- Modify: `test/web/sync.test.ts:100-110`

**Interfaces:**
- Consumes: `toast` from `@lemol/ui/remix`, `ToastTone` from `@lemol/ui/remix`, `@lemol/ui/remix/runtime`.
- Produces: Flash messages rendered via `toast("flash-toast")` with `id="flash-toast"` and `<noscript>` fallback; `entry.ts` dispatches `--dismiss-toast` on load.

- [ ] **Step 1: Write the failing test for Toaster in Document**

Update `test/web/ui.test.tsx`:
```tsx
test("renders flash toast and reload notice in the shell", async () => {
  const html = await renderDocument({
    title: "Acme",
    content: "<p>body</p>",
    flash: { message: "Saved successfully", tone: "info" },
  })
  expect(html).toContain("Saved successfully")
  expect(html).toContain('id="flash-toast"')
  expect(html).toContain('popover="manual"')
  expect(html).toContain('role="status"')
  expect(html).toContain("<noscript>")
  expect(html).toContain('class="flash info"')
  expect(html).toContain("data-reload-notice")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/web/ui.test.tsx`
Expected: FAIL with `expect(html).toContain('id="flash-toast"')`

- [ ] **Step 3: Implement Toaster in Document and Runtime in Entry**

In `src/web/app/ui/document.tsx`:
Import `toast` and `type ToastTone` from `@lemol/ui/remix`.
Define:
```tsx
const flashToast = toast("flash-toast")
```
Inside `Document`:
```tsx
const mapFlashTone = (tone: "info" | "warning" | "error"): ToastTone => {
  if (tone === "error") return "danger"
  return tone
}

const flash =
  options.flash === undefined ? null : (
    <>
      <flashToast.Toast tone={mapFlashTone(options.flash.tone)}>
        {options.flash.message}
      </flashToast.Toast>
      <noscript>
        <div class={`flash ${options.flash.tone}`} role="status">
          {options.flash.message}
        </div>
      </noscript>
    </>
  )
```

In `src/web/app/actions/public/entry.ts`:
Add:
```ts
import "@lemol/ui/remix/runtime"
```
And in `app.ready().then(...)`:
```ts
const triggerFlashToast = () => {
  const toastEl = document.getElementById("flash-toast")
  if (toastEl) {
    const invocation = new Event("command", { bubbles: false, cancelable: true, composed: true })
    Object.defineProperties(invocation, {
      command: { enumerable: true, value: "--dismiss-toast" },
      source: { enumerable: true, value: toastEl },
    })
    toastEl.dispatchEvent(invocation)
  }
}
```
Invoke `triggerFlashToast()` inside `app.ready().then(() => { startLiveRefresh(); triggerFlashToast() })`.

In `test/web/sync.test.ts`:
Update line 105:
```ts
expect(html).toContain('id="flash-toast"')
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/web/ui.test.tsx test/web/sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/app/actions/public/entry.ts src/web/app/ui/document.tsx test/web/ui.test.tsx test/web/sync.test.ts
git commit -m "feat(web): adopt Toaster for flash messages with runtime and noscript fallback"
```

---

### Task 2: Command Palette in Document & AppShell

**Files:**
- Modify: `src/web/app/ui/document.tsx:1-250`
- Modify: `src/web/app/actions/public/entry.ts:1-94`
- Test: `test/web/ui.test.tsx`

**Interfaces:**
- Consumes: `overlay`, `CommandPaletteInput`, `CommandPaletteList`, `CommandPaletteItem`, `Text` from `@lemol/ui/remix`.
- Produces: Command Palette dialog with `id="command-palette"`, trigger button in header `actions`, and `Cmd+K` keyboard shortcut.

- [ ] **Step 1: Write the failing test for Command Palette**

In `test/web/ui.test.tsx`, add:
```tsx
test("renders Command Palette trigger and dialog in Document", async () => {
  const html = await renderDocument({
    title: "Acme",
    project: "acme",
    content: "<p>body</p>",
    switcher: [
      { name: "acme", registered: true },
      { name: "other", registered: true },
    ],
  })
  expect(html).toContain('command="show-modal"')
  expect(html).toContain('commandfor="command-palette"')
  expect(html).toContain('id="command-palette"')
  expect(html).toContain('command="--palette"')
  expect(html).toContain('commandfor="command-palette-list"')
  expect(html).toContain('id="command-palette-list"')
  expect(html).toContain('data-palette-label="Dashboard"')
  expect(html).toContain('data-palette-label="Projects"')
  expect(html).toContain('data-palette-label="Board (acme)"')
  expect(html).toContain('data-palette-label="Switch to project: other"')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/web/ui.test.tsx`
Expected: FAIL with `expect(html).toContain('commandfor="command-palette"')`

- [ ] **Step 3: Implement Command Palette in Document and Entry**

In `src/web/app/ui/document.tsx`:
Import `overlay`, `CommandPaletteInput`, `CommandPaletteList`, `CommandPaletteItem`, `Text` from `@lemol/ui/remix`.
Define:
```tsx
const Palette = overlay("command-palette")
const paletteListId = "command-palette-list"
```
In `Document`:
Construct `commandPaletteDialog`:
```tsx
const project = options.project
const commandPaletteDialog = (
  <Palette.Dialog title="Command Palette">
    <CommandPaletteInput listId={paletteListId} placeholder="Type a command or page…" />
    <CommandPaletteList id={paletteListId}>
      <CommandPaletteItem href={routes.dashboard.href()} id="cmd-dashboard" label="Dashboard" keywords="home overview" />
      <CommandPaletteItem href={routes.projects.index.href()} id="cmd-projects" label="Projects" keywords="repositories manage" />
      {project !== undefined ? (
        <>
          <CommandPaletteItem href={routes.project.board.href({ project })} id="cmd-board" label={`Board (${project})`} keywords="tasks list" />
          <CommandPaletteItem href={routes.project.done.href({ project })} id="cmd-done" label={`Done (${project})`} keywords="completed archive" />
          <CommandPaletteItem href={routes.project.check.href({ project })} id="cmd-check" label={`Check (${project})`} keywords="diagnostics errors warnings" />
        </>
      ) : null}
      {options.switcher?.map((entry) => (
        <CommandPaletteItem
          key={entry.name}
          href={routes.project.board.href({ project: entry.name })}
          id={`cmd-switch-${entry.name}`}
          label={`Switch to project: ${entry.name}`}
          keywords="switch project"
        />
      ))}
      <CommandPaletteItem href={routes.sync.href()} id="cmd-sync" label="Sync all projects" keywords="sync refresh" />
      <CommandPaletteItem href={`${routes.projects.index.href()}#add-project`} id="cmd-add-project" label="Add a project" keywords="new project create" />
    </CommandPaletteList>
    <Text tone="muted">Typing filters the list. Esc closes.</Text>
  </Palette.Dialog>
)
```
In `AppShell`:
In the `actions` prop, combine the `Palette.Trigger` and `switcher`:
```tsx
const actions = (
  <div mix={actionsStyle}>
    <Palette.Trigger size="sm" tone="neutral">⌘K</Palette.Trigger>
    {switcher}
  </div>
)
```
Pass `actions={actions}` to `AppShell`, and place `{commandPaletteDialog}` inside the `AppShell` children.

In `src/web/app/actions/public/entry.ts`:
Add global `keydown` handler:
```ts
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "k") {
    event.preventDefault()
    const palette = document.getElementById("command-palette")
    if (palette instanceof HTMLDialogElement) {
      if (palette.open) palette.close()
      else palette.showModal()
    }
  }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/web/ui.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/app/ui/document.tsx src/web/app/actions/public/entry.ts test/web/ui.test.tsx
git commit -m "feat(web): add Command Palette with overlay dialog, shortcuts, and navigation"
```

---

### Task 3: LiveForm Filter Bar on Dashboard

**Files:**
- Modify: `src/web/app/ui/dashboard.tsx:1-230`
- Test: `test/web/dashboard.test.ts`
- Test: `test/web/ui.test.tsx`

**Interfaces:**
- Consumes: `LiveForm`, `liveSubmit` from `@lemol/ui/remix`.
- Produces: Dashboard filter bar with `command="--live-submit"`, automatic 400ms debouncing, and no-JS submit button.

- [ ] **Step 1: Write the failing test for LiveForm filter bar**

In `test/web/dashboard.test.ts`, add:
```tsx
test("renders LiveForm filter bar with liveSubmit wiring", async () => {
  const html = await renderDashboard({
    overview: emptyOverview,
    projects: [{ name: "acme", source: "fs", location: "/tmp/acme", registered: true, syncable: false, status: "clean" }],
    sources: ["fs"],
    query: defaultQuery,
    now: DateTime.unsafeMake(0),
    syncable: false,
  })
  expect(html).toContain('id="dashboard-filters"')
  expect(html).toContain('command="--live-submit"')
  expect(html).toContain('commandfor="dashboard-filters"')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/web/dashboard.test.ts`
Expected: FAIL with `expect(html).toContain('id="dashboard-filters"')`

- [ ] **Step 3: Implement LiveForm filter bar**

In `src/web/app/ui/dashboard.tsx`:
Import `LiveForm` and `liveSubmit` from `@lemol/ui/remix`.
Update `filterBar`:
```tsx
const filterBar = (options: DashboardOptions): RemixNode => {
  const { query, projects, sources } = options
  const submitAttr = liveSubmit("dashboard-filters")
  return (
    <LiveForm class="filters" id="dashboard-filters" method="get" action={routes.dashboard.href()}>
      <fieldset>
        <legend>Projects</legend>
        {projects.map((info) => (
          <Checkbox
            key={info.name}
            name="project"
            value={info.name}
            checked={query.projects.includes(info.name)}
            label={info.name}
            mix={submitAttr}
          />
        ))}
      </fieldset>
      <fieldset>
        <legend>Sources</legend>
        {sources.map((kind) => (
          <Checkbox
            key={kind}
            name="source"
            value={kind}
            checked={query.sources.includes(kind)}
            label={kind}
            mix={submitAttr}
          />
        ))}
      </fieldset>
      <Field label="Tag" name="tag" value={query.tags.join(" ")} mix={submitAttr} />
      <Field label="Assignee" name="assignee" value={query.assignee ?? ""} mix={submitAttr} />
      <Field control="select" label="State" name="state" mix={submitAttr}>
        <option value="" {...((query.state ?? "") === "" ? { selected: true } : {})}>
          Any state
        </option>
        <option value="ready" {...(query.state === "ready" ? { selected: true } : {})}>
          ready
        </option>
        <option value="blocked" {...(query.state === "blocked" ? { selected: true } : {})}>
          blocked
        </option>
      </Field>
      <Field control="select" label="View" name="view" mix={submitAttr}>
        <option value="projects" {...(query.view === "projects" ? { selected: true } : {})}>
          By project
        </option>
        <option value="flat" {...(query.view === "flat" ? { selected: true } : {})}>
          Flat
        </option>
      </Field>
      <Button type="submit">Filter</Button>
    </LiveForm>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/web/dashboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/app/ui/dashboard.tsx test/web/dashboard.test.ts
git commit -m "feat(web): adopt LiveForm for dashboard filter bar with liveSubmit"
```

---

### Task 4: Projects Table Sorting & Button Enhancements

**Files:**
- Modify: `src/web/app/ui/projects.tsx:1-222`
- Modify: `src/web/app/actions/projects/controller.tsx:1-50`
- Test: `test/web/projects.test.ts`

**Interfaces:**
- Consumes: `SortableColumnHeader`, `Table`, `Button` from `@lemol/ui/remix`.
- Produces: Sortable columns on `ProjectsPage` driven by `?sort=` and `?dir=`, plus upgraded ui Buttons.

- [ ] **Step 1: Write the failing test for Projects table sorting**

In `test/web/projects.test.ts`, add:
```tsx
test("renders sortable headers on projects table and handles ?sort=name&dir=desc", async () => {
  const router = createTestRouter()
  const response = await router.handle(new Request("http://localhost/projects?sort=name&dir=desc"))
  expect(response.status).toBe(200)
  const html = await response.text()
  expect(html).toContain('aria-sort="descending"')
  expect(html).toContain('sort=name&amp;dir=asc')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/web/projects.test.ts`
Expected: FAIL with `expect(html).toContain('aria-sort="descending"')`

- [ ] **Step 3: Implement SortableColumnHeader and Controller Sorting**

In `src/web/app/ui/projects.tsx`:
Import `SortableColumnHeader` from `@lemol/ui/remix`.
Add `location?: string | undefined` to `ProjectsOptions`.
In `ProjectsPage`:
```tsx
const location = options.location ?? routes.projects.index.href()
...
<TableHead>
  <TableRow>
    <SortableColumnHeader field="name" location={location}>Name</SortableColumnHeader>
    <SortableColumnHeader field="source" location={location}>Source</SortableColumnHeader>
    <SortableColumnHeader field="location" location={location}>Location</SortableColumnHeader>
    <SortableColumnHeader field="status" location={location}>Status</SortableColumnHeader>
    <TableHeaderCell>Actions</TableHeaderCell>
  </TableRow>
</TableHead>
```
In `row`:
Upgrade row buttons:
`<Button size="sm" tone="danger" type="submit">Remove</Button>`
`<Button size="sm" tone="neutral" type="submit">Sync</Button>`

In `src/web/app/actions/projects/controller.tsx`:
Parse `sort` and `dir`:
```ts
const url = new URL(context.request.url)
const sort = url.searchParams.get("sort")
const dir = url.searchParams.get("dir") === "desc" ? "desc" : "asc"
let sortedProjects = [...projects]
if (sort) {
  sortedProjects.sort((a, b) => {
    let cmp = 0
    if (sort === "name") cmp = a.name.localeCompare(b.name)
    else if (sort === "source") cmp = a.source.localeCompare(b.source)
    else if (sort === "location") cmp = a.location.localeCompare(b.location)
    else if (sort === "status") cmp = a.status.localeCompare(b.status)
    return dir === "desc" ? -cmp : cmp
  })
}
```
Pass `location: `${url.pathname}${url.search}`` and `projects: sortedProjects` to `ProjectsPage`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/web/projects.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/app/ui/projects.tsx src/web/app/actions/projects/controller.tsx test/web/projects.test.ts
git commit -m "feat(web): add SortableColumnHeader to projects table and upgrade action buttons"
```

---

### Task 5: Remove Task Confirmation Dialog on Task Detail Page

**Files:**
- Modify: `src/web/app/ui/task.tsx:280-340`
- Test: `test/web/ui.test.tsx`
- Test: `test/web/contracts.test.ts`

**Interfaces:**
- Consumes: `overlay` from `@lemol/ui/remix`.
- Produces: `RemoveTask = overlay("remove-task")` dialog on `TaskDetailPage` with warning for open dependents.

- [ ] **Step 1: Write the failing test for Remove Task dialog**

In `test/web/ui.test.tsx`, add:
```tsx
test("renders RemoveTask dialog and trigger on TaskDetailPage", async () => {
  const html = await renderTaskDetail({
    project: "acme",
    task: sampleTask,
    detail: { view: { task: sampleTask, state: "ready" }, dependsOn: [], blocks: [] },
    capabilities: { ...allCapabilities, remove: true },
  })
  expect(html).toContain('command="show-modal"')
  expect(html).toContain('commandfor="remove-task"')
  expect(html).toContain('id="remove-task"')
  expect(html).toContain(`Remove task ${showId(sampleTask.id)}`)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/web/ui.test.tsx`
Expected: FAIL with `expect(html).toContain('commandfor="remove-task"')`

- [ ] **Step 3: Implement RemoveTask dialog on TaskDetailPage**

In `src/web/app/ui/task.tsx`:
Define:
```tsx
const RemoveTask = overlay("remove-task")
```
In `TaskDetailPage`:
```tsx
const dependents = detail.blocks.map((view) => view.task)
const removeTrigger = capabilities.remove ? (
  <RemoveTask.Trigger tone="danger">Remove</RemoveTask.Trigger>
) : null

const removeDialog = capabilities.remove ? (
  <RemoveTask.Dialog title={`Remove task ${showId(task.id)}`}>
    <p>
      Remove{" "}
      <a href={routes.project.tasks.show.href({ project, id: task.id })}>
        {showId(task.id)} {task.title}
      </a>{" "}
      for good? This deletes the task and its file; version control keeps the history.
    </p>
    {dependents.length === 0 ? null : (
      <>
        <p class="warning">
          These open tasks depend on it and will be left with an unknown dependency:
        </p>
        <ul>
          {dependents.map((dep) => (
            <li key={dep.id}>
              <a href={routes.project.tasks.show.href({ project, id: dep.id })}>
                {showId(dep.id)} {dep.title}
              </a>
            </li>
          ))}
        </ul>
      </>
    )}
    <form
      class="actions confirm"
      method="post"
      action={routes.project.tasks.remove.href({ project, id: task.id })}
    >
      {dependents.length === 0 ? null : <input type="hidden" name="force" value="1" />}
      <Button tone="danger" type="submit">
        {dependents.length === 0 ? "Remove" : "Remove anyway"}
      </Button>
      <RemoveTask.Close tone="ghost">Cancel</RemoveTask.Close>
    </form>
  </RemoveTask.Dialog>
) : null
```
Place `{removeTrigger}` in `actions` and `{removeDialog}` alongside `{editDialog}` and `{moveDialog}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/web/ui.test.tsx test/web/contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/app/ui/task.tsx test/web/ui.test.tsx test/web/contracts.test.ts
git commit -m "feat(web): add remove task confirmation dialog on task detail page"
```

---

### Task 6: Full Integration, Docs, and Verification

**Files:**
- Modify: `src/web/README.md`
- Run: `bun run check`
- Run: `bun test test/boundaries.test.ts`
- CLI: Mark task 33 done via `bun src/cli/bin.ts done 33`

**Interfaces:**
- Consumes: All completed tasks 1–5.
- Produces: Updated docs, green check, and closed Task 33.

- [ ] **Step 1: Update src/web/README.md**

Update `src/web/README.md` under `## Adoption of @lemol/ui` to document:
- `Toaster` for flash messages with runtime auto-dismiss and `<noscript>` fallback.
- `CommandPalette` in `AppShell` with `⌘K` shortcut and global navigation.
- `LiveForm` with `liveSubmit` on the dashboard filter bar.
- `Table` with `SortableColumnHeader` on the projects page.
- Native dialogs for Add, Edit, Move, and Remove.

- [ ] **Step 2: Run full verification suite**

Run:
`bun run check`
`bun test test/boundaries.test.ts`
Expected: All linters, typechecks, and tests PASS with zero errors.

- [ ] **Step 3: Close Task 33 using the CLI**

Run:
`bun src/cli/bin.ts done 33`

- [ ] **Step 4: Commit**

```bash
git add src/web/README.md todo/TODO.md todo/33-m3b-toasts-live-filter-command-palette-table.md
git commit -m "docs(web): document M3b UI adoption and close task 33"
```
