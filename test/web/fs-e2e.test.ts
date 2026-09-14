import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Layer, ManagedRuntime } from "effect"
import { TodoService } from "../../src/core/index.ts"
import { FsTodoStore } from "../../src/fs/index.ts"
import { allCapabilities } from "../../src/spec/index.ts"
import { makeFakeChanges } from "../../src/web/app/middleware/changes.ts"
import { createAppRouter } from "../../src/web/app/router.ts"
import { routes } from "../../src/web/app/routes.ts"
import { makeFakeAssets } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test("adds and completes a task through the router over FsTodoStore", async () => {
  const root = await mkdtemp(join(tmpdir(), "todo-md-web-e2e-"))
  await writeFile(join(root, "TODO.md"), "# Disk list\n")
  const runtime = ManagedRuntime.make(
    TodoService.layer.pipe(
      Layer.provide(FsTodoStore.layer({ root })),
      Layer.provide(BunServices.layer),
    ),
  )
  const router = createAppRouter({
    runtime,
    capabilities: allCapabilities,
    changes: makeFakeChanges(),
    author: "tester",
    hosts: ["localhost"],
    sessionSecret: "test-secret-at-least-32-characters",
    assets: makeFakeAssets(),
  })
  cleanup.push(async () => {
    await router.close()
    await runtime.dispose()
    await rm(root, { recursive: true, force: true })
  })

  const add = new FormData()
  add.set("title", "Persist me")
  const added = await router.fetch(
    new Request(`http://localhost${routes.tasks.add.href()}`, {
      method: "POST",
      headers: { Host: "localhost" },
      body: add,
    }),
  )
  expect(added.status).toBe(303)
  expect(await readFile(join(root, "TODO.md"), "utf8")).toContain("Persist me")

  const complete = new FormData()
  complete.set("back", routes.board.href())
  const completed = await router.fetch(
    new Request(`http://localhost${routes.tasks.complete.href({ id: "1" })}`, {
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
  const root = await mkdtemp(join(tmpdir(), "todo-md-web-e2e-"))
  await writeFile(
    join(root, "TODO.md"),
    "# Disk list\n\n- [ ] 1 - One\n- [ ] 2 - Two\n\n## Backend\n\n- [ ] 3 - Three\n",
  )
  const runtime = ManagedRuntime.make(
    TodoService.layer.pipe(
      Layer.provide(FsTodoStore.layer({ root })),
      Layer.provide(BunServices.layer),
    ),
  )
  const router = createAppRouter({
    runtime,
    capabilities: allCapabilities,
    changes: makeFakeChanges(),
    author: "tester",
    hosts: ["localhost"],
    sessionSecret: "test-secret-at-least-32-characters",
    assets: makeFakeAssets(),
  })
  cleanup.push(async () => {
    await router.close()
    await runtime.dispose()
    await rm(root, { recursive: true, force: true })
  })
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

  await post(routes.tasks.move.href({ id: "2" }), { before: "1" })
  await post(routes.tasks.move.href({ id: "1" }), { group: "Backend", position: "top" })
  await post(routes.groups.rename.href(), { from: "Backend", to: "Server" })
  await post(routes.tasks.remove.href({ id: "3" }), {})
  expect(await readFile(join(root, "TODO.md"), "utf8")).toBe(
    "# Disk list\n\n- [ ] 2 - Two\n\n## Server\n\n- [ ] 1 - One\n",
  )
})
