# Design: M3b UI Adoption (Toasts, Live Filter, Command Palette, Table, Remove Dialog)

## Context & Background

Milestone M3 adopted `@lemol/ui` in `src/web` (tasks 25–32), converting the hand-rolled UI to the `mini` design system (`Document`, `AppShell`, `Nav`, states, `@lemol/ui/remix` components) and introducing dialogs for task creation, editing, and moving.

Certain UI components were deferred to M3b (Task 33) because they depended on `@lemol/ui` M2:
1. `Toaster` and `toast()` for flash notifications.
2. `LiveForm` and `liveSubmit()` for the dashboard filter bar.
3. `CommandPalette` (`CommandPaletteInput`, `CommandPaletteList`, `CommandPaletteItem`) for global navigation and quick actions.
4. `Table` with `SortableColumnHeader` for projects table sorting.
5. Revisit the remove-confirm flow as a dialog on the task detail page.

Now that `@lemol/ui` M2 has shipped all of these components, this document designs their adoption into `src/web`.

---

## Goals & Non-goals

### Goals
- **Toaster for flash:** Replace manual `<div class="flash ...">` with `toast("flash-toast")` from `@lemol/ui/remix`. In interactive browsers, open the toast and trigger timed auto-dismissal (5000ms) on load; provide a `<noscript>` inline banner fallback for no-JS environments.
- **Command Palette:** Integrate `overlay("command-palette")` in the `AppShell` actions slot with a `⌘K` trigger and a global `keydown` shortcut. Include global navigation, contextual project pages, project switcher links, and quick actions.
- **LiveForm filter bar:** Upgrade the dashboard filter form to `LiveForm` with `liveSubmit()`, debouncing resubmission on input/change via `@lemol/ui/remix/runtime` while retaining the submit button for no-JS.
- **Projects table sorting & buttons:** Use `SortableColumnHeader` on the projects table to support sorting by Name, Source, Location, and Status, and polish raw action buttons to `@lemol/ui/remix` `Button`s.
- **Remove task dialog:** Convert task removal on the task detail page to an `overlay("remove-task")` modal dialog showing open dependents warnings, while preserving `GET /p/:project/tasks/:id/remove` as the full-page fallback.
- Maintain `bun run check` cleanliness and 100% test pass rate without breaking existing route contracts, capability checks, or no-JS support.

### Non-goals
- Changing Jira or hub backend synchronization logic.
- Introducing client-side single-page client-side router (Remix SSR + progressive enhancement remains the model).
- Converting project removal on `/projects` to a dialog (it stays a form with 422 refusal).

---

## Key Decisions

1. **D1 — Dual Runtime Wiring (`entry.ts`):**
   `entry.ts` imports `@lemol/ui/remix/runtime` alongside `@lemol/ui/remix/compat`. `runtime.ts` installs delegated listeners for `command` and `input`, handling `--dismiss-toast`, `--live-submit`, and `--palette`.

2. **D2 — Server-rendered Toaster with Client-triggered Dismissal:**
   The server renders `<FlashToast.Toast>` (`popover="manual"`) and a `<noscript>` inline banner. On page load, `entry.ts` dispatches a synthetic `command: "--dismiss-toast"` event to `#flash-toast`, invoking `runtime.ts`'s handler to open the popover and schedule dismissal after 5 seconds.

3. **D3 — Shell-level Command Palette:**
   Mounted in `Document` / `AppShell` so it is accessible from every page. It renders with `overlay("command-palette")`, uses `CommandPaletteInput` and `CommandPaletteList`, and hooks `Cmd+K` / `Ctrl+K`.

4. **D4 — Debounced Live Submissions for Dashboard Filters:**
   `LiveForm` with `liveSubmit("dashboard-filters")` on checkboxes and selects uses `runtime.ts`'s 400ms debounce to resubmit the form smoothly on user input without spamming the server.

5. **D5 — Server-driven Table Sorting:**
   Column sorting reads `?sort=` and `?dir=` query params on `GET /projects`. `SortableColumnHeader` generates links that preserve existing query parameters and display active sort indicators (`▲` / `▼`).

6. **D6 — Symmetrical Dialog Pattern for Task Removal:**
   Follows `EditTask` and `MoveTask` by providing an `overlay("remove-task")` dialog on `TaskDetailPage` while keeping `RemoveTaskPage` on `routes.project.tasks.confirmRemove` for deep links and no-JS.

---

## Component Architecture & Detailed Design

### 1. Client Runtime & Asset Wiring (`src/web/app/actions/public/entry.ts`)
- Import `@lemol/ui/remix/runtime`.
- Add auto-dismiss dispatch on page load:
  ```ts
  const flashToast = document.getElementById("flash-toast")
  if (flashToast) {
    const invocation = new Event("command", { bubbles: false, cancelable: true, composed: true })
    Object.defineProperties(invocation, {
      command: { enumerable: true, value: "--dismiss-toast" },
      source: { enumerable: true, value: flashToast },
    })
    flashToast.dispatchEvent(invocation)
  }
  ```
- Add `keydown` shortcut for the Command Palette:
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

### 2. Toaster for Flash Messages (`src/web/app/ui/document.tsx`)
- Create `const flashToast = toast("flash-toast")`.
- When `options.flash` is present:
  - Map `options.flash.tone`:
    - `"error"` → `"danger"`
    - `"warning"` → `"warning"`
    - `"info"` → `"info"`
  - Render `<flashToast.Toast tone={mappedTone}>{options.flash.message}</flashToast.Toast>`.
  - Render `<noscript><div class={`flash ${options.flash.tone}`} role="status">{options.flash.message}</div></noscript>`.

### 3. Command Palette (`src/web/app/ui/document.tsx`)
- Create `const Palette = overlay("command-palette")` and `const paletteListId = "command-palette-list"`.
- In `AppShell` `actions`:
  - Render `<Palette.Trigger size="sm" tone="neutral">⌘K</Palette.Trigger>` next to the project switcher form.
- In `Document`:
  - Render `<Palette.Dialog title="Command Palette">`:
    - `<CommandPaletteInput listId={paletteListId} placeholder="Type a command or page…" />`
    - `<CommandPaletteList id={paletteListId}>` with items:
      - `CommandPaletteItem`: Dashboard (`/`)
      - `CommandPaletteItem`: Projects (`/projects`)
      - Contextual items if `project` is defined:
        - Board (`/p/${project}`)
        - Done (`/p/${project}/done`)
        - Check (`/p/${project}/check`)
      - Project switcher items from `options.switcher`:
        - For each project: `Switch to project: ${entry.name}` (`/p/${entry.name}`)
      - Quick actions:
        - `Sync all projects` (`/sync`)
        - `Add a project` (`/projects#add-project`)
    - Helper note `<Text tone="muted">Typing filters the list. Esc closes.</Text>`.

### 4. LiveForm Filter Bar (`src/web/app/ui/dashboard.tsx`)
- Replace `<form class="filters">` with `<LiveForm id="dashboard-filters" method="get" action={routes.dashboard.href()} mix={filtersStyle}>`.
- Add `mix={liveSubmit("dashboard-filters")}` to:
  - Project checkboxes
  - Source checkboxes
  - `tag` and `assignee` `Field` inputs
  - `state` and `view` `Field` selects
- Preserve `<Button type="submit">Filter</Button>` for no-JS.

### 5. Projects Table & Sorting (`src/web/app/ui/projects.tsx`, `src/web/app/actions/projects/controller.tsx`)
- `ProjectsPage` receives `location` string (e.g. `/projects?sort=name&dir=asc`).
- In `TableHead`:
  - `SortableColumnHeader field="name" location={location}>Name</SortableColumnHeader>`
  - `SortableColumnHeader field="source" location={location}>Source</SortableColumnHeader>`
  - `SortableColumnHeader field="location" location={location}>Location</SortableColumnHeader>`
  - `SortableColumnHeader field="status" location={location}>Status</SortableColumnHeader>`
  - `TableHeaderCell>Actions</TableHeaderCell>`
- In `src/web/app/actions/projects/controller.tsx`:
  - Parse `sort` and `dir` from `request.url`.
  - Sort the `projects` array before rendering.
- Upgrade table row buttons:
  - Remove button: `<Button size="sm" tone="danger" type="submit">Remove</Button>`
  - Sync button: `<Button size="sm" tone="neutral" type="submit">Sync</Button>`

### 6. Remove Task Dialog (`src/web/app/ui/task.tsx`)
- Create `const RemoveTask = overlay("remove-task")`.
- On `TaskDetailPage`:
  - When `capabilities.remove`:
    - In header actions, render `<RemoveTask.Trigger tone="danger">Remove</RemoveTask.Trigger>`.
    - Render `<RemoveTask.Dialog title={`Remove task ${showId(task.id)}`}>`:
      - Confirmation text.
      - Open dependents warning (if `detail.blocks` has open tasks).
      - POST form to `routes.project.tasks.remove.href({ project, id: task.id })` with hidden `force=1` if dependents exist.
      - Submit button: "Remove" or "Remove anyway".
      - Cancel button: `<RemoveTask.Close tone="ghost">Cancel</RemoveTask.Close>`.
- Keep `RemoveTaskPage` on `routes.project.tasks.confirmRemove` intact as the direct route and no-JS fallback.

---

## Testing & Validation Plan

1. **Unit & Shell Tests (`test/web/ui.test.tsx`):**
   - Verify `Document` renders `id="flash-toast"` with `popover="manual"` and `<noscript>` fallback when flash is present.
   - Verify `Document` renders Command Palette trigger button (`⌘K`) and `<dialog id="command-palette">` with list items.
   - Verify `DashboardPage` renders `LiveForm` with `command="--live-submit"` and `commandfor="dashboard-filters"`.
   - Verify `ProjectsPage` renders `SortableColumnHeader` elements with appropriate `aria-sort` and sort links.
   - Verify `TaskDetailPage` renders `RemoveTask.Dialog` and `RemoveTask.Trigger`.

2. **Controller & Integration Tests (`test/web/contracts.test.ts`, `test/web/projects.test.ts`, `test/web/sync.test.ts`):**
   - Verify `GET /projects?sort=name&dir=desc` sorts projects in descending order.
   - Verify flash messages set by task mutations and project sync are rendered inside the toast element.
   - Verify remove form in the task dialog submits successfully and removes tasks (with `force` when dependents exist).

3. **Repo Verification:**
   - Run `bun run check` (linter, TypeScript typecheck, all tests).
   - Run `test/boundaries.test.ts` to guarantee module boundaries remain clean.
