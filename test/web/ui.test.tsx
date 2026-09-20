/** @jsxImportSource remix/ui */

import { afterEach, expect, test } from "bun:test"
import { DateTime } from "effect"
import { renderToString } from "remix/ui/server"
import { localBack } from "../../src/web/app/actions/forms.ts"
import { statusFor } from "../../src/web/app/actions/respond.tsx"
import { createAssets } from "../../src/web/app/assets.ts"
import { routes } from "../../src/web/app/routes.ts"
import { Document } from "../../src/web/app/ui/document.tsx"
import { markdownHtml } from "../../src/web/app/ui/markdown.tsx"
import { CheckPage } from "../../src/web/app/ui/secondary.tsx"
import { statusTone, syncStatusBadge } from "../../src/web/app/ui/status.tsx"
import { makeRouter } from "./harness.ts"

const renderDocument = async (options: Parameters<typeof Document>[0]["props"]) =>
  await renderToString(<Document {...options} />)

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

test("renders the shared document shell with the project badge", async () => {
  const { router, project, close } = await makeRouter()
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
