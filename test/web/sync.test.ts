import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SyncError } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { makeRouter } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

const open = async (options: Parameters<typeof makeRouter>[0] = {}) => {
  const app = await makeRouter(options)
  cleanup.push(app.close)

  return app
}

const postApp = (
  router: Awaited<ReturnType<typeof makeRouter>>["router"],
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

const required = (value: string | null | undefined): string => {
  if (value === null || value === undefined) throw new Error("expected a value")

  return value
}

const syncing = (summary: string) =>
  memorySource({
    kind: "syncs",
    sync: () => Effect.succeed({ summary }),
  })

const failing = memorySource({
  kind: "fails",
  sync: (project) =>
    Effect.fail(new SyncError({ project: project.name, reason: "auth", message: "auth failed" })),
})

describe("sync", () => {
  test("POST /sync syncs everything and flashes a summary", async () => {
    const app = await open({
      projects: [
        { name: "ok", source: "syncs" },
        { name: "bad", source: "fails" },
      ],
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
    const app = await open({
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
    const app = await open({
      projects: [{ name: "bad", source: "fails" }],
      extraSources: [failing],
    })

    const response = await postApp(app.router, "/p/bad/sync", {})
    const html = await (
      await app.router.fetch(
        new Request("http://localhost/", {
          headers: { Host: "localhost", Cookie: required(response.headers.get("Set-Cookie")) },
        }),
      )
    ).text()

    expect(html).toContain("auth failed")
    expect(html).toContain('id="flash-toast"')
    expect(response.status).toBe(303)
  })

  test("an off-site back value falls back to the dashboard", async () => {
    const app = await open({
      projects: [{ name: "ok", source: "syncs" }],
      extraSources: [syncing("ok")],
    })

    const response = await postApp(app.router, "/sync", { back: "//evil.example" })
    expect(response.headers.get("Location")).toBe("/")
  })
})
