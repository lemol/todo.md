/** @jsxImportSource remix/component */

import { afterEach, expect, test } from "bun:test"
import { DateTime } from "effect"
import { renderToString } from "remix/component/server"
import type { Dependency } from "../../src/core/index.ts"
import { allCapabilities, type Task } from "../../src/spec/index.ts"
import { parseDashboardQuery } from "../../src/web/app/actions/dashboard/query.ts"
import { localBack } from "../../src/web/app/actions/forms.ts"
import { statusFor } from "../../src/web/app/actions/respond.tsx"
import { createAssets } from "../../src/web/app/assets.ts"
import { routes } from "../../src/web/app/routes.ts"
import { DashboardPage } from "../../src/web/app/ui/dashboard.tsx"
import { Document, ErrorPage } from "../../src/web/app/ui/document.tsx"
import { showId } from "../../src/web/app/ui/format.ts"
import { markdownHtml } from "../../src/web/app/ui/markdown.tsx"
import { CheckPage } from "../../src/web/app/ui/secondary.tsx"
import { statusTone, syncStatusBadge } from "../../src/web/app/ui/status.tsx"
import { TaskPage } from "../../src/web/app/ui/task.tsx"
import { makeRouter } from "./harness.ts"

const renderDocument = async (options: Parameters<typeof Document>[0]["props"]) =>
  await renderToString(<Document {...options} />)

const sampleTask: Task = {
  id: "1",
  title: "Write documentation",
  description: "Detailed description",
  status: "open",
  tags: ["docs"],
  assignee: "lemol",
  dependsOn: [],
  comments: [],
  extra: {},
}

const renderTaskDetail = async (props: {
  readonly project: string
  readonly task?: Task
  readonly detail: {
    readonly view: {
      readonly task: Task
      readonly state: "ready" | "blocked" | "done"
      readonly blockedBy?: ReadonlyArray<string>
    }
    readonly dependsOn?: ReadonlyArray<Dependency>
    readonly dependencies?: ReadonlyArray<Dependency>
    readonly blocks?: ReadonlyArray<{
      readonly task: Task
      readonly state?: "ready" | "blocked" | "done"
      readonly blockedBy?: ReadonlyArray<string>
    }>
  }
  readonly capabilities: typeof allCapabilities
  readonly author?: string
}) =>
  await renderToString(
    <TaskPage
      project={props.project}
      detail={{
        view: { ...props.detail.view, blockedBy: props.detail.view.blockedBy ?? [] },
        dependencies: props.detail.dependencies ?? props.detail.dependsOn ?? [],
        blocks: (props.detail.blocks ?? []).map((b) => ({
          task: b.task,
          state: b.state ?? "ready",
          blockedBy: b.blockedBy ?? [],
        })),
      }}
      capabilities={props.capabilities}
      author={props.author ?? "lemol"}
    />,
  )

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
    // `remix/*` subpaths are barrels, and the asset server rewrites named
    // imports through them to the implementation modules, so they reach the
    // browser as preloads rather than import-map entries.
    expect(entry.preloads.some((href) => href.includes("remix-run/component/dist/"))).toBe(true)
    expect(JSON.stringify(entry.importMap)).toContain("@lemol/ui")
    expect(entry.preloads.length).toBeGreaterThan(0)
    expect((await assets.fetch(new Request(`http://localhost${entry.href}`)))?.status).toBe(200)
  } finally {
    await assets.close()
  }
})

test("the header carries the switcher, hub links and the live event list", async () => {
  const html = await renderDocument({
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
  expect(html).not.toContain("data-project")
})

test("the sync badge carries the hub's words and a matching pastel", async () => {
  const now = DateTime.makeUnsafe("2026-09-16T12:00:00.000Z")
  const never = await renderToString(syncStatusBadge({ result: "never" }, now))
  expect(never).toContain("never synced")
  expect(never).toContain("--ui-badge-neutral-bg")
  expect(statusTone({ result: "error", error: "auth" })).toBe("error")
  expect(statusTone({ result: "ok", diverged: true })).toBe("error")
  expect(statusTone({ result: "ok", ahead: 2 })).toBe("blocked")
  expect(statusTone({ result: "ok", lastSync: now })).toBe("ready")
  const errorBadge = await renderToString(
    syncStatusBadge({ result: "error", error: "<script>" }, now),
  )

  expect(errorBadge).toContain("&lt;script&gt;")
  expect(errorBadge).toContain("--ui-badge-danger-bg")
})

test("renders the shared document shell with mini theme and shell", async () => {
  const { router, project, close } = await makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request(`http://localhost/p/${project}`, { headers: { Host: "localhost" } }),
  )

  const html = await response.text()
  expect(html).toMatch(/^<!doctype html>/i)
  expect(html).toContain('lang="en"')
  expect(html).toContain('name="viewport"')
  expect(html).not.toContain("styles.css")
  expect(html).toContain("--ui-btn-radius")
  expect(html).toContain("Skip to content")
  expect(html).toContain('<main id="main"')
  expect(html).toContain("Acme")
  expect(html).toContain(`>${project}<`)
  expect(html).toContain("Board")
  expect(html).toContain("Done")
  expect(html).toContain("Check")
  expect(html).toContain(`data-live-region`)
  expect(html).toContain(`data-project="${project}"`)
})

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

test("renders ErrorPage using mini ErrorState", async () => {
  const html = await renderToString(
    <ErrorPage status={404} message="Task not found" project="acme" />,
  )

  expect(html).toContain("404 error")
  expect(html).toContain("Task not found")
  expect(html).toContain("Back to board")
  expect(html).toContain('href="/p/acme"')
})

test("renders CheckPage with diagnostics using @lemol/ui components", async () => {
  const html = await renderToString(
    <CheckPage
      project="acme"
      diagnostics={[
        {
          code: "unknown-dependency",
          message: "Task depends on unknown task 999",
          severity: "error",
          taskId: "1",
          file: "todo/TODO.md",
          line: 42,
        },
      ]}
    />,
  )

  expect(html).toContain("Errors")
  expect(html).toContain("unknown-dependency")
  expect(html).toContain("Task depends on unknown task 999")
  expect(html).toContain("task 01")
  expect(html).toContain('href="/p/acme/tasks/1"')
  expect(html).toContain("todo/TODO.md:42")
})

test("renders CheckPage empty state", async () => {
  const html = await renderToString(<CheckPage project="acme" diagnostics={[]} />)
  expect(html).toContain("Check")
  expect(html).toContain("No diagnostics.")
})

test("renders complete dialog markup for no-JS without client runtime", async () => {
  const { router, project, close } = await makeRouter()
  cleanup.push(close)

  const boardRes = await router.fetch(
    new Request(`http://localhost/p/${project}`, { headers: { Host: "localhost" } }),
  )

  const boardHtml = await boardRes.text()
  expect(boardHtml).toContain('command="show-modal"')
  expect(boardHtml).toContain('commandfor="add-task"')
  expect(boardHtml).toContain('id="add-task"')
  expect(boardHtml).toMatch(/<h2[^>]*id="add-task-title"[^>]*>Add task<\/h2>/)
  expect(boardHtml).toContain(`action="/p/${project}/tasks"`)
  expect(boardHtml).toContain('name="title"')
  expect(boardHtml).toContain('command="close"')
  expect(boardHtml).toContain('commandfor="add-task"')

  const form = new FormData()
  form.set("title", "Check dialogs")
  const addRes = await router.fetch(
    new Request(`http://localhost/p/${project}/tasks`, {
      method: "POST",
      body: form,
      headers: { Host: "localhost" },
    }),
  )

  expect(addRes.status).toBe(303)

  const taskRes = await router.fetch(
    new Request(`http://localhost/p/${project}/tasks/1`, { headers: { Host: "localhost" } }),
  )

  const taskHtml = await taskRes.text()
  expect(taskHtml).toContain('command="show-modal"')
  expect(taskHtml).toContain('commandfor="edit-task"')
  expect(taskHtml).toContain('id="edit-task"')
  expect(taskHtml).toMatch(/<h2[^>]*id="edit-task-title"[^>]*>Edit task 01<\/h2>/)
  expect(taskHtml).toContain(`action="/p/${project}/tasks/1"`)
  expect(taskHtml).toContain('name="title"')
  expect(taskHtml).toContain('name="description"')
  expect(taskHtml).toContain('command="close"')
  expect(taskHtml).toContain('commandfor="edit-task"')

  expect(taskHtml).toContain('command="show-modal"')
  expect(taskHtml).toContain('commandfor="move-task"')
  expect(taskHtml).toContain('id="move-task"')
  expect(taskHtml).toMatch(/<h2[^>]*id="move-task-title"[^>]*>Move task 01<\/h2>/)
  expect(taskHtml).toContain(`action="/p/${project}/tasks/1/move"`)
  expect(taskHtml).toContain('name="position"')
  expect(taskHtml).toContain('command="close"')
  expect(taskHtml).toContain('commandfor="move-task"')

  expect(taskHtml).toContain('command="show-modal"')
  expect(taskHtml).toContain('commandfor="remove-task"')
  expect(taskHtml).toContain('id="remove-task"')
  expect(taskHtml).toMatch(/<h2[^>]*id="remove-task-title"[^>]*>Remove task 01<\/h2>/)
  expect(taskHtml).toContain(`action="/p/${project}/tasks/1/remove"`)
  expect(taskHtml).toContain('command="close"')
  expect(taskHtml).toContain('commandfor="remove-task"')
})

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

test("renders Command Palette in project-less context without contextual project items", async () => {
  const html = await renderDocument({
    title: "Dashboard",
    content: "<p>body</p>",
    switcher: [
      { name: "acme", registered: true },
      { name: "other", registered: true },
    ],
  })

  expect(html).toContain('data-palette-label="Dashboard"')
  expect(html).toContain('data-palette-label="Projects"')
  expect(html).not.toContain("Board (")
  expect(html).not.toContain("Done (")
  expect(html).not.toContain("Check (")
})

test("renders LiveForm filter bar with liveSubmit wiring in DashboardPage", async () => {
  const html = await renderToString(
    <DashboardPage
      overview={{ projects: [], tasks: [] }}
      projects={[
        {
          name: "acme",
          source: "fs",
          location: "/tmp/acme",
          registered: true,
          syncable: false,
          status: { result: "ok" },
        },
      ]}
      sources={["fs"]}
      query={parseDashboardQuery(new URL("http://localhost/"))}
      now={DateTime.makeUnsafe("2026-09-16T12:00:00.000Z")}
      syncable={false}
    />,
  )

  expect(html).toContain('id="dashboard-filters"')
  expect(html).toContain('command="--live-submit"')
  expect(html).toContain('commandfor="dashboard-filters"')
})

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

test("renders RemoveTask dialog with open dependents warning on TaskDetailPage", async () => {
  const dependentTask: Task = {
    ...sampleTask,
    id: "2",
    title: "Dependent task",
  }

  const html = await renderTaskDetail({
    project: "acme",
    task: sampleTask,
    detail: {
      view: { task: sampleTask, state: "ready" },
      dependsOn: [],
      blocks: [{ task: dependentTask, state: "blocked" }],
    },
    capabilities: { ...allCapabilities, remove: true },
  })

  expect(html).toContain("These open tasks depend on it")
  expect(html).toContain("Dependent task")
  expect(html).toContain('name="force" value="1"')
  expect(html).toContain("Remove anyway")
})

test("does not render RemoveTask trigger or dialog when remove capability is false", async () => {
  const html = await renderTaskDetail({
    project: "acme",
    task: sampleTask,
    detail: { view: { task: sampleTask, state: "ready" }, dependsOn: [], blocks: [] },
    capabilities: { ...allCapabilities, remove: false },
  })

  expect(html).not.toContain('commandfor="remove-task"')
  expect(html).not.toContain('id="remove-task"')
})
