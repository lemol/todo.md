import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Schema } from "effect"
import { type AnySource, fsSource, Hub, SourceError } from "../../src/hub/index.ts"
import { TodoStore } from "../../src/spec/index.ts"
import { makeRouter, seed } from "./harness.ts"

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

const fetchApp = (router: Awaited<ReturnType<typeof makeRouter>>["router"], path: string) =>
  router.fetch(new Request(`http://localhost${path}`, { headers: { Host: "localhost" } }))

const twoProjects = {
  projects: [
    { name: "acme", fields: { title: "Acme" } },
    { name: "work", fields: { title: "Work" } },
  ],
}

describe("dashboard", () => {
  test("lists projects in registry order with counts and next tasks", async () => {
    const app = await open(twoProjects)
    await seed(app.hubRuntime, "acme", (todo) => todo.add({ title: "Write docs", tags: ["docs"] }))
    await seed(app.hubRuntime, "work", (todo) => todo.add({ title: "Ship it" }))
    const html = await (await fetchApp(app.router, "/")).text()
    expect(html.indexOf("Acme")).toBeLessThan(html.indexOf("Work"))
    expect(html).toContain("1 open")
    expect(html).toContain("1 ready")
    expect(html).toContain("Write docs")
    expect(html).toContain('href="/p/acme"')
    expect(html).toContain('class="badge muted">memory</span>')
  })

  test("shows at most five ready tasks per project", async () => {
    const app = await open()
    for (const index of [1, 2, 3, 4, 5, 6]) {
      await seed(app.hubRuntime, "acme", (todo) => todo.add({ title: `Task ${index}` }))
    }
    const html = await (await fetchApp(app.router, "/")).text()
    expect(html).toContain("Task 5")
    expect(html).not.toContain("Task 6")
    expect(html).toContain("1 more")
  })

  test("the source filter lists every loaded source kind", async () => {
    const app = await open({ extraSources: [fsSource] })
    const html = await (await fetchApp(app.router, "/")).text()
    expect(html).toContain('name="source" value="memory"')
    expect(html).toContain('name="source" value="fs"')
  })

  test("each filter narrows the results", async () => {
    const app = await open(twoProjects)
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

  test("state=ready and state=blocked narrow the dashboard", async () => {
    const app = await open()
    await seed(app.hubRuntime, "acme", (todo) =>
      Effect.gen(function* () {
        yield* todo.add({ title: "Blocker" })
        yield* todo.add({ title: "Blocked task", dependsOn: ["1"] })
        yield* todo.add({ title: "Ready solo" })
      }),
    )
    const ready = await (await fetchApp(app.router, "/?state=ready")).text()
    expect(ready).toContain("Blocker")
    expect(ready).toContain("Ready solo")
    expect(ready).not.toContain("Blocked task")

    const blocked = await (await fetchApp(app.router, "/?state=blocked")).text()
    expect(blocked).toContain("0 ready · 1 blocked")
    expect(blocked).not.toContain("Ready solo")

    const blockedFlat = await (await fetchApp(app.router, "/?state=blocked&view=flat")).text()
    expect(blockedFlat).toContain("Blocked task")
  })

  test("register replaces the unregistered startup project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "todo-md-register-"))
    writeFileSync(join(dir, "TODO.md"), "# Disk list\n")
    const app = await open({ projects: [], listDir: dir })
    const before = await (await fetchApp(app.router, "/")).text()
    expect(before).toContain("Register")
    expect(before).toContain("not registered")
    const response = await postApp(app.router, "/projects", {
      target: dir,
      name: "work",
      source: "fs",
    })
    expect(response.status).toBe(303)
    const listed = await app.hubRuntime.runPromise(Effect.flatMap(Hub, (hub) => hub.projects()))
    expect(listed.map((info) => info.name)).toEqual(["work"])
    expect(listed.every((info) => info.registered)).toBe(true)
  })

  test("the flat view lists qualified ids across projects", async () => {
    const app = await open(twoProjects)
    await seed(app.hubRuntime, "acme", (todo) => todo.add({ title: "Write docs" }))
    await seed(app.hubRuntime, "work", (todo) => todo.add({ title: "Ship it" }))
    const html = await (await fetchApp(app.router, "/?view=flat")).text()
    expect(html).toContain("acme:1")
    expect(html).toContain("work:1")
    expect(html).toContain('href="/p/acme/tasks/1"')
  })

  test("rejects an invalid state or view with 400", async () => {
    const app = await open()
    expect((await fetchApp(app.router, "/?state=soon")).status).toBe(400)
    expect((await fetchApp(app.router, "/?view=grid")).status).toBe(400)
  })

  test("an empty registry points at /projects", async () => {
    const app = await open({ projects: [] })
    const html = await (await fetchApp(app.router, "/")).text()
    expect(html).toContain("No projects yet.")
    expect(html).toContain('href="/projects"')
  })

  test("the switcher redirects to a project's board", async () => {
    const app = await open(twoProjects)
    const response = await fetchApp(app.router, "/go?project=work")
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe("/p/work")
  })

  test("the switcher refuses an unknown project", async () => {
    const app = await open(twoProjects)
    expect((await fetchApp(app.router, "/go?project=nope")).status).toBe(404)
  })

  test("a broken project shows an error entry and the others still render", async () => {
    const broken: AnySource = {
      kind: "broken",
      config: Schema.Struct({}),
      location: () => "broken",
      open: () =>
        Layer.effect(
          TodoStore,
          Effect.fail(new SourceError({ name: "bad", message: "cannot open" })),
        ),
    }
    const app = await open({
      projects: [
        { name: "acme", fields: { title: "Acme" } },
        { name: "bad", source: "broken" },
      ],
      extraSources: [broken],
    })
    const html = await (await fetchApp(app.router, "/")).text()
    expect(html).toContain(">acme<")
    expect(html).toContain("cannot open")
    expect(html).toContain("project-error")
    expect(html).toContain('action="/p/bad/sync"')
  })

  test("the dashboard's live region listens to every hub event", async () => {
    const app = await open()
    const html = await (await fetchApp(app.router, "/")).text()
    expect(html).toContain('data-live-events="changed synced registry"')
    expect(html).not.toContain("data-project=")
  })
})
