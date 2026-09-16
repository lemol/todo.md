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
