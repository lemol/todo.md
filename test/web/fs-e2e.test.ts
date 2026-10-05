import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Layer, ManagedRuntime } from "effect"
import { fsSource, Hub } from "../../src/hub/index.ts"
import type { HubRuntime } from "../../src/web/app/middleware/project.tsx"
import { createAppRouter } from "../../src/web/app/router.ts"
import { routes } from "../../src/web/app/routes.ts"
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
    cwd: root,
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
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { Host: "localhost" },
        body,
      }),
    )

    expect(response.status).toBe(303)
  }

  await post(routes.project.tasks.move.href({ project, id: "2" }), { before: "1" })
  await post(routes.project.tasks.move.href({ project, id: "1" }), {
    group: "Backend",
    position: "top",
  })
  await post(routes.project.groups.rename.href({ project }), { from: "Backend", to: "Server" })
  await post(routes.project.tasks.remove.href({ project, id: "3" }), {})
  expect(await readFile(join(root, "TODO.md"), "utf8")).toBe(
    "# Disk list\n\n- [ ] 2 - Two\n\n## Server\n\n- [ ] 1 - One\n",
  )
})
