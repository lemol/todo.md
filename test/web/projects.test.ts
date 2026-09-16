import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { fsSource, SourceError } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { makeRouter } from "./harness.ts"

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

const required = (value: string | null | undefined): string => {
  if (value === null || value === undefined) throw new Error("expected a value")
  return value
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
    expect(html).toContain('<span class="muted">—</span>')
    expect(html).toContain('action="/projects"')
    expect(html).toContain('data-live-events="registry synced"')
  })

  test("adds a project and redirects to its board", async () => {
    const app = open({ extraSources: [fsSource] })
    const dir = mkdtempSync(join(tmpdir(), "todo-md-add-"))
    writeFileSync(join(dir, "TODO.md"), "# New\n\n- [ ] First\n")
    const response = await postApp(app.router, "/projects", { target: dir, name: "new" })
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe("/p/new")
    const listed = await (await fetchApp(app.router, "/projects")).text()
    expect(listed).toContain("new")
  })

  test("a duplicate name re-renders the form with 422", async () => {
    const app = open({ extraSources: [fsSource] })
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
          : Effect.fail(new SourceError({ name: project.name, message: "1 unpushed commit" })),
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
})
