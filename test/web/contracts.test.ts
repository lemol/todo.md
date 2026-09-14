import { afterEach, describe, expect, test } from "bun:test"
import { TodoService } from "../../src/core/index.ts"
import { allCapabilities, type Capabilities } from "../../src/spec/index.ts"
import { makeFakeChanges } from "../../src/web/app/middleware/changes.ts"
import { createAppRouter } from "../../src/web/app/router.ts"
import { routes } from "../../src/web/app/routes.ts"
import { makeFakeAssets, makeRuntime } from "./harness.ts"

const open: Array<{ close(): Promise<void> }> = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((value) => value.close()))
})

const appWith = (
  runtime: ReturnType<typeof makeRuntime>,
  capabilities: Capabilities = allCapabilities,
) => {
  const router = createAppRouter({
    runtime,
    capabilities,
    changes: makeFakeChanges(),
    author: "tester",
    hosts: ["localhost"],
    sessionSecret: "test-secret-at-least-32-characters",
    assets: makeFakeAssets(),
  })
  open.push(router, { close: () => runtime.dispose() })
  return router
}

const fetchApp = (
  router: ReturnType<typeof createAppRouter>,
  path: string,
  init: RequestInit = {},
) =>
  router.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { Host: "localhost", ...init.headers },
    }),
  )

const required = (value: string | null | undefined): string => {
  if (value === null || value === undefined) throw new Error("expected a value")
  return value
}

const seed = async (runtime: ReturnType<typeof makeRuntime>) =>
  runtime.runPromise(
    TodoService.use((todo) => todo.add({ title: "Write docs", tags: ["docs"], assignee: "lemol" })),
  )

describe("board contract", () => {
  test("renders filters, capabilities, state summary, and linked blockers", async () => {
    const runtime = makeRuntime()
    await seed(runtime)
    const blocker = await runtime.runPromise(
      TodoService.use((todo) => todo.add({ title: "Build API" }, { group: "Backend" })),
    )
    await runtime.runPromise(
      TodoService.use((todo) =>
        todo.add({ title: "Ship UI", dependsOn: [blocker.id] }, { group: "Frontend" }),
      ),
    )
    const html = await (await fetchApp(appWith(runtime), routes.board.href())).text()

    expect(html).toContain("3 open · 2 ready · 1 blocked")
    expect(html).toContain("?tag=docs")
    expect(html).toContain("?assignee=lemol")
    expect(html).toContain('name="group"')
    expect(html).toContain("new group…")
    expect(html).toContain(`href="${routes.tasks.show.href({ id: blocker.id })}"`)
    expect(html).toContain("blocked by")
    expect(html).toContain('data-next="true"')

    const filterRuntime = makeRuntime()
    await seed(filterRuntime)
    const filtered = await (
      await fetchApp(appWith(filterRuntime), `${routes.board.href()}?state=ready`)
    ).text()
    expect(filtered).toContain(`${routes.board.href()}?state=ready&amp;tag=docs`)
  })

  test("hides unsupported controls", async () => {
    const runtime = makeRuntime()
    const task = await seed(runtime)
    const capabilities = { ...allCapabilities, groups: false, comments: false }
    const router = appWith(runtime, capabilities)

    const board = await (await fetchApp(router, routes.board.href())).text()
    const detail = await (await fetchApp(router, routes.tasks.show.href({ id: task.id }))).text()
    expect(board).not.toContain('name="group"')
    expect(detail).not.toContain(`action="${routes.tasks.comments.href({ id: task.id })}"`)
  })

  test("adds a task to a new group", async () => {
    const runtime = makeRuntime()
    const router = appWith(runtime)
    const form = new FormData()
    form.set("title", "Grouped task")
    form.set("group", "__new__")
    form.set("newGroup", "Launch")
    const added = await fetchApp(router, routes.tasks.add.href(), { method: "POST", body: form })
    expect(added.status).toBe(303)
    const location = added.headers.get("location")
    expect(location).toBe(routes.tasks.show.href({ id: "1" }))
    const detail = await (await fetchApp(router, required(location))).text()
    expect(detail).toContain("Launch")
  })
})

describe("task forms and detail", () => {
  test("shows complete metadata, actions, comments newest first, and a populated edit form", async () => {
    const runtime = makeRuntime()
    const dependency = await seed(runtime)
    const task = await runtime.runPromise(
      TodoService.use((todo) =>
        todo.add({
          title: "Ship UI",
          description: "**Important**",
          tags: ["web", "release"],
          assignee: "agent",
          dependsOn: [dependency.id],
        }),
      ),
    )
    await runtime.runPromise(
      TodoService.use((todo) => todo.comment(task.id, { author: "one", body: "First" })),
    )
    await runtime.runPromise(
      TodoService.use((todo) => todo.comment(task.id, { author: "two", body: "Second" })),
    )
    const router = appWith(runtime)
    const detail = await (await fetchApp(router, routes.tasks.show.href({ id: task.id }))).text()
    const edit = await (await fetchApp(router, routes.tasks.edit.href({ id: task.id }))).text()

    expect(detail).toContain("<strong>Important</strong>")
    expect(detail).toContain("#web")
    expect(detail).toContain("@agent")
    expect(detail).toContain("Write docs")
    expect(detail).toContain(`action="${routes.tasks.complete.href({ id: task.id })}"`)
    expect(detail).toContain(`action="${routes.tasks.comments.href({ id: task.id })}"`)
    expect(detail.indexOf("Second")).toBeLessThan(detail.indexOf("First"))
    expect(edit).toContain('value="Ship UI"')
    expect(edit).toContain(">**Important**</textarea>")
    expect(edit).toContain('value="web release"')
    expect(edit).toContain('value="agent"')
    expect(edit).toContain(`value="${dependency.id}"`)

    const update = new FormData()
    update.set("title", "Ship polished UI")
    update.set("description", "**Important**")
    update.set("tags", "web release")
    update.set("assignee", "agent")
    update.set("dependsOn", dependency.id)
    const updated = await fetchApp(router, routes.tasks.update.href({ id: task.id }), {
      method: "POST",
      body: update,
    })
    expect(updated.status).toBe(303)
    const updatedHtml = await (
      await fetchApp(router, routes.tasks.show.href({ id: task.id }))
    ).text()
    expect(updatedHtml).toContain("Ship polished UI")
    expect(updatedHtml).toContain("#release")
    expect(updatedHtml).toContain("@agent")
    expect(updatedHtml).toContain("Write docs")

    const comment = new FormData()
    comment.set("author", "three")
    comment.set("body", "Newest")
    expect(
      (
        await fetchApp(router, routes.tasks.comments.href({ id: task.id }), {
          method: "POST",
          body: comment,
        })
      ).status,
    ).toBe(303)
    expect(
      await (await fetchApp(router, routes.tasks.show.href({ id: task.id }))).text(),
    ).toContain("Newest")
  })

  test("re-renders add and edit forms with submitted values on validation errors", async () => {
    const runtime = makeRuntime()
    const first = await seed(runtime)
    const second = await runtime.runPromise(
      TodoService.use((todo) => todo.add({ title: "Second", dependsOn: [first.id] })),
    )
    const router = appWith(runtime)

    const blank = new FormData()
    blank.set("title", "")
    const addResponse = await fetchApp(router, routes.tasks.add.href(), {
      method: "POST",
      body: blank,
    })
    const addHtml = await addResponse.text()
    expect(addResponse.status).toBe(422)
    expect(addHtml).toContain("Title is required")
    expect(addHtml).toContain(`action="${routes.tasks.add.href()}"`)
    expect(addHtml).toContain("data-live-region")

    const cycle = new FormData()
    cycle.set("title", "Write docs")
    cycle.set("description", "submitted description")
    cycle.set("tags", "docs")
    cycle.set("assignee", "lemol")
    cycle.set("dependsOn", second.id)
    const editResponse = await fetchApp(router, routes.tasks.update.href({ id: first.id }), {
      method: "POST",
      body: cycle,
    })
    const editHtml = await editResponse.text()
    expect(editResponse.status).toBe(422)
    expect(editHtml).toContain("dependency cycle")
    expect(editHtml).toContain("submitted description")
    expect(editHtml).toContain('value="lemol"')
  })
})

describe("lifecycle, flash, and secondary pages", () => {
  test("completes with a flash, reports newly ready tasks, and handles a stale tab", async () => {
    const runtime = makeRuntime()
    const blocker = await seed(runtime)
    const unblocked = await runtime.runPromise(
      TodoService.use((todo) => todo.add({ title: "Release", dependsOn: [blocker.id] })),
    )
    const router = appWith(runtime)
    const form = new FormData()
    form.set("back", "/?state=ready")
    const completed = await fetchApp(router, routes.tasks.complete.href({ id: blocker.id }), {
      method: "POST",
      body: form,
    })
    const cookie = completed.headers.get("set-cookie")?.split(";", 1)[0]
    expect(completed.status).toBe(303)
    expect(completed.headers.get("location")).toBe("/?state=ready")
    expect(cookie).toBeTruthy()

    const board = await fetchApp(router, "/?state=ready", {
      headers: { Cookie: required(cookie) },
    })
    expect(await board.text()).toContain(`Completed 01. Now ready: 02`)

    const stale = await fetchApp(router, routes.tasks.complete.href({ id: blocker.id }), {
      method: "POST",
      body: form,
      headers: { Cookie: required(cookie) },
    })
    expect(stale.status).toBe(303)
    const staleCookie = stale.headers.get("set-cookie")?.split(";", 1)[0]
    const afterStale = await fetchApp(router, routes.board.href(), {
      headers: { Cookie: required(staleCookie) },
    })
    expect(await afterStale.text()).toContain("cannot be completed")

    const done = await (await fetchApp(router, routes.done.href())).text()
    expect(done).toContain("Write docs")
    expect(done).toContain(`action="${routes.tasks.reopen.href({ id: blocker.id })}"`)
    expect(done).toMatch(/<code>\d{4}-\d{2}-\d{2}<\/code>/)
    expect(done).not.toContain(unblocked.title)
  })

  test("returns shared pages for missing tasks and diagnostic groups", async () => {
    const runtime = makeRuntime()
    const task = await seed(runtime)
    await runtime.runPromise(TodoService.use((todo) => todo.update(task.id, { dependsOn: ["99"] })))
    const router = appWith(runtime)

    const missing = await fetchApp(router, routes.tasks.show.href({ id: "404" }))
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain("Back to board")

    const missingComplete = await fetchApp(router, routes.tasks.complete.href({ id: "404" }), {
      method: "POST",
      body: new FormData(),
    })
    expect(missingComplete.status).toBe(404)

    const check = await (await fetchApp(router, routes.check.href())).text()
    expect(check).toContain("Errors")
    expect(check).toContain("unknown-dependency")
    expect(check).toContain(routes.tasks.show.href({ id: task.id }))
  })
})

const post = (router: ReturnType<typeof createAppRouter>, path: string, fields: object) => {
  const body = new FormData()
  for (const [name, value] of Object.entries(fields)) body.set(name, String(value))
  return fetchApp(router, path, { method: "POST", body })
}

const cookieOf = (response: Response): string =>
  required(response.headers.get("set-cookie")?.split(";", 1)[0])

describe("move, remove, and group management", () => {
  const titlesOf = async (runtime: ReturnType<typeof makeRuntime>) =>
    (await runtime.runPromise(TodoService.use((todo) => todo.list()))).sections.map((section) => ({
      name: section.name,
      titles: section.tasks.map((view) => view.task.title),
    }))

  const seedThree = async (runtime: ReturnType<typeof makeRuntime>) => {
    const add = (title: string, group?: string) =>
      runtime.runPromise(
        TodoService.use((todo) => todo.add({ title }, group === undefined ? {} : { group })),
      )
    return [await add("One"), await add("Two"), await add("Three", "Backend")]
  }

  test("board rows move up and down within their section", async () => {
    const runtime = makeRuntime()
    const [one, two] = await seedThree(runtime)
    const router = appWith(runtime)
    const board = await (await fetchApp(router, routes.board.href())).text()
    const move = (id: string) => `action="${routes.tasks.move.href({ id })}"`
    expect(board).toContain(move(required(two?.id)))
    expect(board).toContain(`name="before" value="${one?.id}"`)
    expect(board).toContain('aria-label="Move One down"')
    expect(board).not.toContain('aria-label="Move One up"')

    const moved = await post(router, routes.tasks.move.href({ id: required(two?.id) }), {
      before: required(one?.id),
      back: "/?tag=x",
    })
    expect(moved.status).toBe(303)
    expect(moved.headers.get("location")).toBe("/?tag=x")
    expect(await titlesOf(runtime)).toEqual([
      { name: undefined, titles: ["Two", "One"] },
      { name: "Backend", titles: ["Three"] },
    ])
  })

  test("the task page moves a task to the top or bottom of a group", async () => {
    const runtime = makeRuntime()
    const [one, two] = await seedThree(runtime)
    const router = appWith(runtime)
    const page = await (
      await fetchApp(router, routes.tasks.show.href({ id: required(one?.id) }))
    ).text()
    expect(page).toContain(`action="${routes.tasks.move.href({ id: required(one?.id) })}"`)
    expect(page).toContain('<option value="Backend">Backend</option>')

    const moved = await post(router, routes.tasks.move.href({ id: required(one?.id) }), {
      group: "Backend",
      position: "top",
      back: routes.tasks.show.href({ id: required(one?.id) }),
    })
    expect(moved.status).toBe(303)
    const after = await fetchApp(router, required(moved.headers.get("location")), {
      headers: { Cookie: cookieOf(moved) },
    })
    expect(await after.text()).toContain("Moved 01 to Backend.")

    await post(router, routes.tasks.move.href({ id: required(two?.id) }), {
      group: "__new__",
      newGroup: "Launch",
      position: "top",
    })
    await post(router, routes.tasks.move.href({ id: required(one?.id) }), {
      group: "",
      position: "bottom",
    })
    expect(await titlesOf(runtime)).toEqual([
      { name: undefined, titles: ["One"] },
      { name: "Backend", titles: ["Three"] },
      { name: "Launch", titles: ["Two"] },
    ])

    const blank = await post(router, routes.tasks.move.href({ id: required(one?.id) }), {
      group: "__new__",
      newGroup: "",
    })
    expect(blank.status).toBe(422)
    expect(await blank.text()).toContain("New group is required")
  })

  test("moving a done task redirects back with a warning", async () => {
    const runtime = makeRuntime()
    const task = await seed(runtime)
    await runtime.runPromise(TodoService.use((todo) => todo.complete(task.id)))
    const router = appWith(runtime)
    const moved = await post(router, routes.tasks.move.href({ id: task.id }), {
      position: "top",
    })
    expect(moved.status).toBe(303)
    const board = await fetchApp(router, routes.board.href(), {
      headers: { Cookie: cookieOf(moved) },
    })
    expect(await board.text()).toContain("cannot be moved")
    const page = await (await fetchApp(router, routes.tasks.show.href({ id: task.id }))).text()
    expect(page).not.toContain(`action="${routes.tasks.move.href({ id: task.id })}"`)
  })

  test("removes a task after confirming, forcing past open dependents", async () => {
    const runtime = makeRuntime()
    const blocker = await seed(runtime)
    await runtime.runPromise(
      TodoService.use((todo) => todo.add({ title: "Release", dependsOn: [blocker.id] })),
    )
    const router = appWith(runtime)
    const detail = await (await fetchApp(router, routes.tasks.show.href({ id: blocker.id }))).text()
    expect(detail).toContain(`href="${routes.tasks.confirmRemove.href({ id: blocker.id })}"`)

    const confirm = await (
      await fetchApp(router, routes.tasks.confirmRemove.href({ id: blocker.id }))
    ).text()
    expect(confirm).toContain("Release")
    expect(confirm).toContain('name="force" value="1"')
    expect(confirm).toContain("Remove anyway")

    const refused = await post(router, routes.tasks.remove.href({ id: blocker.id }), {})
    expect(refused.status).toBe(422)
    expect(await refused.text()).toContain("still has open tasks depending on it: 2")

    const removed = await post(router, routes.tasks.remove.href({ id: blocker.id }), {
      force: "1",
    })
    expect(removed.status).toBe(303)
    expect(removed.headers.get("location")).toBe(routes.board.href())
    const board = await fetchApp(router, routes.board.href(), {
      headers: { Cookie: cookieOf(removed) },
    })
    expect(await board.text()).toContain("Removed 01 Write docs.")
    expect((await fetchApp(router, routes.tasks.show.href({ id: blocker.id }))).status).toBe(404)
  })

  test("removing a done task returns to Done", async () => {
    const runtime = makeRuntime()
    const task = await seed(runtime)
    await runtime.runPromise(TodoService.use((todo) => todo.complete(task.id)))
    const router = appWith(runtime)
    const confirm = await (
      await fetchApp(router, routes.tasks.confirmRemove.href({ id: task.id }))
    ).text()
    expect(confirm).not.toContain('name="force"')
    const removed = await post(router, routes.tasks.remove.href({ id: task.id }), {})
    expect(removed.headers.get("location")).toBe(routes.done.href())
  })

  test("renames a group and rejects a name that exists", async () => {
    const runtime = makeRuntime()
    await seedThree(runtime)
    await runtime.runPromise(
      TodoService.use((todo) => todo.add({ title: "Four" }, { group: "Ops" })),
    )
    const router = appWith(runtime)
    const editHref = routes.groups.edit.href(undefined, { searchParams: { name: "Backend" } })
    const board = await (await fetchApp(router, routes.board.href())).text()
    expect(board).toContain(`href="${editHref}"`)

    const edit = await (await fetchApp(router, editHref)).text()
    expect(edit).toContain('name="from" value="Backend"')

    const taken = await post(router, routes.groups.rename.href(), { from: "Backend", to: "Ops" })
    expect(taken.status).toBe(422)
    expect(await taken.text()).toContain('value="Ops"')

    const blank = await post(router, routes.groups.rename.href(), { from: "Backend", to: " " })
    expect(blank.status).toBe(422)

    const renamed = await post(router, routes.groups.rename.href(), {
      from: "Backend",
      to: "Server",
    })
    expect(renamed.status).toBe(303)
    const after = await fetchApp(router, routes.board.href(), {
      headers: { Cookie: cookieOf(renamed) },
    })
    expect(await after.text()).toContain("Renamed group Backend to Server.")
    expect((await titlesOf(runtime)).map((section) => section.name)).toEqual([
      undefined,
      "Server",
      "Ops",
    ])

    const missing = await fetchApp(
      router,
      routes.groups.edit.href(undefined, { searchParams: { name: "Nope" } }),
    )
    expect(missing.status).toBe(400)
  })

  test("hides move, and rename without reorder and renameGroup", async () => {
    const runtime = makeRuntime()
    const [one] = await seedThree(runtime)
    const router = appWith(runtime, { ...allCapabilities, reorder: false, renameGroup: false })
    const board = await (await fetchApp(router, routes.board.href())).text()
    const page = await (
      await fetchApp(router, routes.tasks.show.href({ id: required(one?.id) }))
    ).text()
    expect(board).not.toContain('class="moves"')
    expect(board).not.toContain(routes.groups.edit.href())
    expect(page).not.toContain(`action="${routes.tasks.move.href({ id: required(one?.id) })}"`)
    const edit = await fetchApp(
      router,
      routes.groups.edit.href(undefined, { searchParams: { name: "Backend" } }),
    )
    expect(edit.status).toBe(400)
  })
})
