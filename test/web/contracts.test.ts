import { afterEach, describe, expect, test } from "bun:test"
import type { Capabilities } from "../../src/spec/index.ts"
import { routes } from "../../src/web/app/routes.ts"
import { showId } from "../../src/web/app/ui/format.ts"
import { makeRouter, seed } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

const open = async () => {
  const app = await makeRouter()
  cleanup.push(app.close)
  return app
}

const openWith = async (capabilities: Partial<Capabilities>) => {
  const app = await makeRouter({ capabilities })
  cleanup.push(app.close)
  return app
}

const fetchApp = (
  router: Awaited<ReturnType<typeof makeRouter>>["router"],
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

const seedDocs = (
  hubRuntime: Awaited<ReturnType<typeof makeRouter>>["hubRuntime"],
  project: string,
) =>
  seed(hubRuntime, project, (todo) =>
    todo.add({ title: "Write docs", tags: ["docs"], assignee: "lemol" }),
  )

describe("board contract", () => {
  test("renders filters, capabilities, state summary, and linked blockers", async () => {
    const { router, hubRuntime, project } = await open()
    await seedDocs(hubRuntime, project)
    const blocker = await seed(hubRuntime, project, (todo) =>
      todo.add({ title: "Build API" }, { group: "Backend" }),
    )
    await seed(hubRuntime, project, (todo) =>
      todo.add({ title: "Ship UI", dependsOn: [blocker.id] }, { group: "Frontend" }),
    )
    const html = await (await fetchApp(router, routes.project.board.href({ project }))).text()

    expect(html).toContain("3 open · 2 ready · 1 blocked")
    expect(html).toContain("?tag=docs")
    expect(html).toContain("?assignee=lemol")
    expect(html).toContain('name="group"')
    expect(html).toContain("new group…")
    expect(html).toContain(`href="${routes.project.tasks.show.href({ project, id: blocker.id })}"`)
    expect(html).toContain("blocked by")
    expect(html).toContain('data-next="true"')

    const filter = await open()
    await seedDocs(filter.hubRuntime, filter.project)
    const filtered = await (
      await fetchApp(
        filter.router,
        `${routes.project.board.href({ project: filter.project })}?state=ready`,
      )
    ).text()
    expect(filtered).toContain(
      `${routes.project.board.href({ project: filter.project })}?state=ready&amp;tag=docs`,
    )
  })

  test("shows no sync button on a non-syncable project", async () => {
    const { router, project } = await open()
    const html = await (await fetchApp(router, routes.project.board.href({ project }))).text()
    expect(html).not.toContain('action="/p/acme/sync"')
  })

  test("hides unsupported controls", async () => {
    const { router, hubRuntime, project } = await openWith({
      groups: false,
      comments: false,
      cancel: false,
    })
    const task = await seedDocs(hubRuntime, project)

    const board = await (await fetchApp(router, routes.project.board.href({ project }))).text()
    const detail = await (
      await fetchApp(router, routes.project.tasks.show.href({ project, id: task.id }))
    ).text()
    expect(board).not.toContain('name="group"')
    expect(detail).not.toContain(
      `action="${routes.project.tasks.comments.href({ project, id: task.id })}"`,
    )
    expect(detail).not.toContain(
      `action="${routes.project.tasks.cancel.href({ project, id: task.id })}"`,
    )
  })

  test("offers no add form when the store cannot add", async () => {
    // Seeded through the source's own config: the app has no way to add here.
    const app = await makeRouter({
      capabilities: { add: false },
      projects: [{ name: "acme", fields: { title: "Acme", tasks: [{ title: "Mirrored" }] } }],
    })
    cleanup.push(app.close)
    const board = await (
      await fetchApp(app.router, routes.project.board.href({ project: app.project }))
    ).text()
    expect(board).toContain("Mirrored")
    expect(board).not.toContain(
      `action="${routes.project.tasks.add.href({ project: app.project })}"`,
    )
    expect(board).not.toContain("Add task")

    // Posting to the route anyway says so, rather than a board with no reason on it.
    const form = new FormData()
    form.set("title", "")
    const posted = await fetchApp(
      app.router,
      routes.project.tasks.add.href({ project: app.project }),
      { method: "POST", body: form },
    )
    expect(posted.status).toBe(400)
    expect(await posted.text()).toContain("does not support add")
  })

  test("offers no removal when the store cannot remove", async () => {
    const { router, hubRuntime, project } = await openWith({ remove: false })
    const task = await seedDocs(hubRuntime, project)

    const detail = await (
      await fetchApp(router, routes.project.tasks.show.href({ project, id: task.id }))
    ).text()
    expect(detail).not.toContain(
      `href="${routes.project.tasks.confirmRemove.href({ project, id: task.id })}"`,
    )

    // Reaching the confirm page directly says so rather than asking.
    const confirm = await fetchApp(
      router,
      routes.project.tasks.confirmRemove.href({ project, id: task.id }),
    )
    expect(confirm.status).toBe(400)
    expect(await confirm.text()).toContain("does not support remove")
  })

  test("adds a task to a new group", async () => {
    const { router, project } = await open()
    const form = new FormData()
    form.set("title", "Grouped task")
    form.set("group", "__new__")
    form.set("newGroup", "Launch")
    const added = await fetchApp(router, routes.project.tasks.add.href({ project }), {
      method: "POST",
      body: form,
    })
    expect(added.status).toBe(303)
    const location = added.headers.get("location")
    expect(location).toBe(routes.project.tasks.show.href({ project, id: "1" }))
    const detail = await (await fetchApp(router, required(location))).text()
    expect(detail).toContain("Launch")
  })

  test("renders add task dialog with invoker trigger and dialog panel", async () => {
    const { router, project } = await open()
    const html = await (await fetchApp(router, routes.project.board.href({ project }))).text()
    expect(html).toContain('command="show-modal"')
    expect(html).toContain('commandfor="add-task"')
    expect(html).toContain("<dialog")
    expect(html).toContain('id="add-task"')
    expect(html).toContain('command="close"')
    expect(html).toContain('commandfor="add-task"')
    expect(html).toContain(`action="${routes.project.tasks.add.href({ project })}"`)
  })

  test("renders add form inline on 422 validation error", async () => {
    const { router, project } = await open()
    const form = new FormData()
    form.set("title", "")
    const response = await fetchApp(router, routes.project.tasks.add.href({ project }), {
      method: "POST",
      body: form,
    })
    expect(response.status).toBe(422)
    const html = await response.text()
    expect(html).toContain("Title is required")
    expect(html).toContain(`action="${routes.project.tasks.add.href({ project })}"`)
  })
})

describe("task forms and detail", () => {
  test("shows complete metadata, actions, comments newest first, and a populated edit form", async () => {
    const { router, hubRuntime, project } = await open()
    const dependency = await seedDocs(hubRuntime, project)
    const task = await seed(hubRuntime, project, (todo) =>
      todo.add({
        title: "Ship UI",
        description: "**Important**",
        tags: ["web", "release"],
        assignee: "agent",
        dependsOn: [dependency.id],
      }),
    )
    await seed(hubRuntime, project, (todo) =>
      todo.comment(task.id, { author: "one", body: "First" }),
    )
    await seed(hubRuntime, project, (todo) =>
      todo.comment(task.id, { author: "two", body: "Second" }),
    )
    const detail = await (
      await fetchApp(router, routes.project.tasks.show.href({ project, id: task.id }))
    ).text()
    const edit = await (
      await fetchApp(router, routes.project.tasks.edit.href({ project, id: task.id }))
    ).text()

    expect(detail).toContain("<strong>Important</strong>")
    expect(detail).toContain("#web")
    expect(detail).toContain("@agent")
    expect(detail).toContain("Write docs")
    expect(detail).toContain(
      `action="${routes.project.tasks.complete.href({ project, id: task.id })}"`,
    )
    expect(detail).toContain(
      `action="${routes.project.tasks.comments.href({ project, id: task.id })}"`,
    )
    expect(detail).toContain('command="show-modal"')
    expect(detail).toContain('commandfor="edit-task"')
    expect(detail).toContain("<dialog")
    expect(detail).toContain('id="edit-task"')
    expect(detail).toContain('command="close"')
    expect(detail).toContain('commandfor="edit-task"')
    expect(detail).toContain(
      `action="${routes.project.tasks.update.href({ project, id: task.id })}"`,
    )
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
    const updated = await fetchApp(
      router,
      routes.project.tasks.update.href({ project, id: task.id }),
      {
        method: "POST",
        body: update,
      },
    )
    expect(updated.status).toBe(303)
    const updatedHtml = await (
      await fetchApp(router, routes.project.tasks.show.href({ project, id: task.id }))
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
        await fetchApp(router, routes.project.tasks.comments.href({ project, id: task.id }), {
          method: "POST",
          body: comment,
        })
      ).status,
    ).toBe(303)
    expect(
      await (
        await fetchApp(router, routes.project.tasks.show.href({ project, id: task.id }))
      ).text(),
    ).toContain("Newest")
  })

  test("a cancelled task reads as cancelled with its reason; a completed task still reads as completed", async () => {
    const { router, hubRuntime, project } = await open()
    const cancelled = await seedDocs(hubRuntime, project)
    await seed(hubRuntime, project, (todo) => todo.cancel(cancelled.id, "Superseded by d47fcd2."))
    const completed = await seed(hubRuntime, project, (todo) => todo.add({ title: "Ship it" }))
    await seed(hubRuntime, project, (todo) => todo.complete(completed.id))

    const cancelledDetail = await (
      await fetchApp(router, routes.project.tasks.show.href({ project, id: cancelled.id }))
    ).text()
    expect(cancelledDetail).toContain("Cancelled")
    expect(cancelledDetail).toContain("Superseded by d47fcd2.")
    expect(cancelledDetail).not.toContain("Completed")
    expect(cancelledDetail).toContain(
      `action="${routes.project.tasks.reopen.href({ project, id: cancelled.id })}"`,
    )

    const completedDetail = await (
      await fetchApp(router, routes.project.tasks.show.href({ project, id: completed.id }))
    ).text()
    expect(completedDetail).toContain("Completed")
    expect(completedDetail).not.toContain("Cancelled")
  })

  test("cancels an open task with a reason, flashing without a now-ready list", async () => {
    const { router, hubRuntime, project } = await open()
    const task = await seedDocs(hubRuntime, project)
    const detail = await (
      await fetchApp(router, routes.project.tasks.show.href({ project, id: task.id }))
    ).text()
    expect(detail).toContain(
      `action="${routes.project.tasks.cancel.href({ project, id: task.id })}"`,
    )

    const cancelled = await post(
      router,
      routes.project.tasks.cancel.href({ project, id: task.id }),
      {
        reason: "No longer needed",
        back: routes.project.tasks.show.href({ project, id: task.id }),
      },
    )
    expect(cancelled.status).toBe(303)
    const after = await fetchApp(router, required(cancelled.headers.get("location")), {
      headers: { Cookie: cookieOf(cancelled) },
    })
    const afterHtml = await after.text()
    expect(afterHtml).toContain(`Cancelled ${showId(task.id)}.`)
    expect(afterHtml).not.toContain("Now ready")
    expect(afterHtml).toContain("No longer needed")

    const missingReason = await post(
      router,
      routes.project.tasks.cancel.href({ project, id: (await seedDocs(hubRuntime, project)).id }),
      {},
    )
    expect(missingReason.status).toBe(400)
    expect(await missingReason.text()).toContain("needs a reason")
  })

  test("re-renders add and edit forms with submitted values on validation errors", async () => {
    const { router, hubRuntime, project } = await open()
    const first = await seedDocs(hubRuntime, project)
    const second = await seed(hubRuntime, project, (todo) =>
      todo.add({ title: "Second", dependsOn: [first.id] }),
    )

    const blank = new FormData()
    blank.set("title", "")
    const addResponse = await fetchApp(router, routes.project.tasks.add.href({ project }), {
      method: "POST",
      body: blank,
    })
    const addHtml = await addResponse.text()
    expect(addResponse.status).toBe(422)
    expect(addHtml).toContain("Title is required")
    expect(addHtml).toContain(`action="${routes.project.tasks.add.href({ project })}"`)
    expect(addHtml).toContain("data-live-region")

    const cycle = new FormData()
    cycle.set("title", "Write docs")
    cycle.set("description", "submitted description")
    cycle.set("tags", "docs")
    cycle.set("assignee", "lemol")
    cycle.set("dependsOn", second.id)
    const editResponse = await fetchApp(
      router,
      routes.project.tasks.update.href({ project, id: first.id }),
      {
        method: "POST",
        body: cycle,
      },
    )
    const editHtml = await editResponse.text()
    expect(editResponse.status).toBe(422)
    expect(editHtml).toContain("dependency cycle")
    expect(editHtml).toContain("submitted description")
    expect(editHtml).toContain('value="lemol"')
  })
})

describe("lifecycle, flash, and secondary pages", () => {
  test("completes with a flash, reports newly ready tasks, and handles a stale tab", async () => {
    const { router, hubRuntime, project } = await open()
    const blocker = await seedDocs(hubRuntime, project)
    const unblocked = await seed(hubRuntime, project, (todo) =>
      todo.add({ title: "Release", dependsOn: [blocker.id] }),
    )
    const boardReady = `${routes.project.board.href({ project })}?state=ready`
    const form = new FormData()
    form.set("back", boardReady)
    const completed = await fetchApp(
      router,
      routes.project.tasks.complete.href({ project, id: blocker.id }),
      {
        method: "POST",
        body: form,
      },
    )
    const cookie = completed.headers.get("set-cookie")?.split(";", 1)[0]
    expect(completed.status).toBe(303)
    expect(completed.headers.get("location")).toBe(boardReady)
    expect(cookie).toBeTruthy()

    const board = await fetchApp(router, boardReady, {
      headers: { Cookie: required(cookie) },
    })
    expect(await board.text()).toContain(`Completed 01. Now ready: 02`)

    const stale = await fetchApp(
      router,
      routes.project.tasks.complete.href({ project, id: blocker.id }),
      {
        method: "POST",
        body: form,
        headers: { Cookie: required(cookie) },
      },
    )
    expect(stale.status).toBe(303)
    const staleCookie = stale.headers.get("set-cookie")?.split(";", 1)[0]
    const afterStale = await fetchApp(router, routes.project.board.href({ project }), {
      headers: { Cookie: required(staleCookie) },
    })
    expect(await afterStale.text()).toContain("cannot be completed")

    const done = await (await fetchApp(router, routes.project.done.href({ project }))).text()
    expect(done).toContain("Write docs")
    expect(done).toContain(
      `action="${routes.project.tasks.reopen.href({ project, id: blocker.id })}"`,
    )
    expect(done).toMatch(/<code>\d{4}-\d{2}-\d{2}<\/code>/)
    expect(done).not.toContain(unblocked.title)
  })

  test("returns shared pages for missing tasks and diagnostic groups", async () => {
    const { router, hubRuntime, project } = await open()
    const task = await seedDocs(hubRuntime, project)
    await seed(hubRuntime, project, (todo) => todo.update(task.id, { dependsOn: ["99"] }))

    const missing = await fetchApp(router, routes.project.tasks.show.href({ project, id: "404" }))
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain("Back to board")

    const missingComplete = await fetchApp(
      router,
      routes.project.tasks.complete.href({ project, id: "404" }),
      {
        method: "POST",
        body: new FormData(),
      },
    )
    expect(missingComplete.status).toBe(404)

    const check = await (await fetchApp(router, routes.project.check.href({ project }))).text()
    expect(check).toContain("Errors")
    expect(check).toContain("unknown-dependency")
    expect(check).toContain(routes.project.tasks.show.href({ project, id: task.id }))
  })
})

const post = (
  router: Awaited<ReturnType<typeof makeRouter>>["router"],
  path: string,
  fields: object,
) => {
  const body = new FormData()
  for (const [name, value] of Object.entries(fields)) body.set(name, String(value))
  return fetchApp(router, path, { method: "POST", body })
}

const cookieOf = (response: Response): string =>
  required(response.headers.get("set-cookie")?.split(";", 1)[0])

describe("move, remove, and group management", () => {
  const titlesOf = async (
    hubRuntime: Awaited<ReturnType<typeof makeRouter>>["hubRuntime"],
    project: string,
  ) =>
    (await seed(hubRuntime, project, (todo) => todo.list())).sections.map((section) => ({
      name: section.name,
      titles: section.tasks.map((view) => view.task.title),
    }))

  const seedThree = async (
    hubRuntime: Awaited<ReturnType<typeof makeRouter>>["hubRuntime"],
    project: string,
  ) => {
    const add = (title: string, group?: string) =>
      seed(hubRuntime, project, (todo) => todo.add({ title }, group === undefined ? {} : { group }))
    return [await add("One"), await add("Two"), await add("Three", "Backend")]
  }

  test("board rows move up and down within their section", async () => {
    const { router, hubRuntime, project } = await open()
    const [one, two] = await seedThree(hubRuntime, project)
    const board = await (await fetchApp(router, routes.project.board.href({ project }))).text()
    const move = (id: string) => `action="${routes.project.tasks.move.href({ project, id })}"`
    expect(board).toContain(move(required(two?.id)))
    expect(board).toContain(`name="before" value="${one?.id}"`)
    expect(board).toContain('aria-label="Move One down"')
    expect(board).not.toContain('aria-label="Move One up"')

    const moved = await post(
      router,
      routes.project.tasks.move.href({ project, id: required(two?.id) }),
      {
        before: required(one?.id),
        back: `${routes.project.board.href({ project })}?tag=x`,
      },
    )
    expect(moved.status).toBe(303)
    expect(moved.headers.get("location")).toBe(`${routes.project.board.href({ project })}?tag=x`)
    expect(await titlesOf(hubRuntime, project)).toEqual([
      { name: undefined, titles: ["Two", "One"] },
      { name: "Backend", titles: ["Three"] },
    ])
  })

  test("the task page moves a task to the top or bottom of a group", async () => {
    const { router, hubRuntime, project } = await open()
    const [one, two] = await seedThree(hubRuntime, project)
    const page = await (
      await fetchApp(router, routes.project.tasks.show.href({ project, id: required(one?.id) }))
    ).text()
    expect(page).toContain(
      `action="${routes.project.tasks.move.href({ project, id: required(one?.id) })}"`,
    )
    expect(page).toContain('<option value="Backend">Backend</option>')
    expect(page).toContain('command="show-modal"')
    expect(page).toContain('commandfor="move-task"')
    expect(page).toContain("<dialog")
    expect(page).toContain('id="move-task"')
    expect(page).toContain('command="close"')
    expect(page).toContain('commandfor="move-task"')

    const moved = await post(
      router,
      routes.project.tasks.move.href({ project, id: required(one?.id) }),
      {
        group: "Backend",
        position: "top",
        back: routes.project.tasks.show.href({ project, id: required(one?.id) }),
      },
    )
    expect(moved.status).toBe(303)
    const after = await fetchApp(router, required(moved.headers.get("location")), {
      headers: { Cookie: cookieOf(moved) },
    })
    expect(await after.text()).toContain("Moved 01 to Backend.")

    await post(router, routes.project.tasks.move.href({ project, id: required(two?.id) }), {
      group: "__new__",
      newGroup: "Launch",
      position: "top",
    })
    await post(router, routes.project.tasks.move.href({ project, id: required(one?.id) }), {
      group: "",
      position: "bottom",
    })
    expect(await titlesOf(hubRuntime, project)).toEqual([
      { name: undefined, titles: ["One"] },
      { name: "Backend", titles: ["Three"] },
      { name: "Launch", titles: ["Two"] },
    ])

    const blank = await post(
      router,
      routes.project.tasks.move.href({ project, id: required(one?.id) }),
      {
        group: "__new__",
        newGroup: "",
      },
    )
    expect(blank.status).toBe(422)
    expect(await blank.text()).toContain("New group is required")
  })

  test("moving a done task redirects back with a warning", async () => {
    const { router, hubRuntime, project } = await open()
    const task = await seedDocs(hubRuntime, project)
    await seed(hubRuntime, project, (todo) => todo.complete(task.id))
    const moved = await post(router, routes.project.tasks.move.href({ project, id: task.id }), {
      position: "top",
    })
    expect(moved.status).toBe(303)
    const board = await fetchApp(router, routes.project.board.href({ project }), {
      headers: { Cookie: cookieOf(moved) },
    })
    expect(await board.text()).toContain("cannot be moved")
    const page = await (
      await fetchApp(router, routes.project.tasks.show.href({ project, id: task.id }))
    ).text()
    expect(page).not.toContain(
      `action="${routes.project.tasks.move.href({ project, id: task.id })}"`,
    )
  })

  test("removes a task after confirming, forcing past open dependents", async () => {
    const { router, hubRuntime, project } = await open()
    const blocker = await seedDocs(hubRuntime, project)
    await seed(hubRuntime, project, (todo) =>
      todo.add({ title: "Release", dependsOn: [blocker.id] }),
    )
    const detail = await (
      await fetchApp(router, routes.project.tasks.show.href({ project, id: blocker.id }))
    ).text()
    expect(detail).toContain(
      `href="${routes.project.tasks.confirmRemove.href({ project, id: blocker.id })}"`,
    )

    const confirm = await (
      await fetchApp(router, routes.project.tasks.confirmRemove.href({ project, id: blocker.id }))
    ).text()
    expect(confirm).toContain("Release")
    expect(confirm).toContain('name="force" value="1"')
    expect(confirm).toContain("Remove anyway")

    const refused = await post(
      router,
      routes.project.tasks.remove.href({ project, id: blocker.id }),
      {},
    )
    expect(refused.status).toBe(422)
    expect(await refused.text()).toContain("still has open tasks depending on it: 2")

    const removed = await post(
      router,
      routes.project.tasks.remove.href({ project, id: blocker.id }),
      {
        force: "1",
      },
    )
    expect(removed.status).toBe(303)
    expect(removed.headers.get("location")).toBe(routes.project.board.href({ project }))
    const board = await fetchApp(router, routes.project.board.href({ project }), {
      headers: { Cookie: cookieOf(removed) },
    })
    expect(await board.text()).toContain("Removed 01 Write docs.")
    expect(
      (await fetchApp(router, routes.project.tasks.show.href({ project, id: blocker.id }))).status,
    ).toBe(404)
  })

  test("removing a done task returns to Done", async () => {
    const { router, hubRuntime, project } = await open()
    const task = await seedDocs(hubRuntime, project)
    await seed(hubRuntime, project, (todo) => todo.complete(task.id))
    const confirm = await (
      await fetchApp(router, routes.project.tasks.confirmRemove.href({ project, id: task.id }))
    ).text()
    expect(confirm).not.toContain('name="force"')
    const removed = await post(
      router,
      routes.project.tasks.remove.href({ project, id: task.id }),
      {},
    )
    expect(removed.headers.get("location")).toBe(routes.project.done.href({ project }))
  })

  test("renames a group and rejects a name that exists", async () => {
    const { router, hubRuntime, project } = await open()
    await seedThree(hubRuntime, project)
    await seed(hubRuntime, project, (todo) => todo.add({ title: "Four" }, { group: "Ops" }))
    const editHref = routes.project.groups.edit.href(
      { project },
      { searchParams: { name: "Backend" } },
    )
    const board = await (await fetchApp(router, routes.project.board.href({ project }))).text()
    expect(board).toContain(`href="${editHref}"`)

    const edit = await (await fetchApp(router, editHref)).text()
    expect(edit).toContain('name="from" value="Backend"')

    const taken = await post(router, routes.project.groups.rename.href({ project }), {
      from: "Backend",
      to: "Ops",
    })
    expect(taken.status).toBe(422)
    expect(await taken.text()).toContain('value="Ops"')

    const blank = await post(router, routes.project.groups.rename.href({ project }), {
      from: "Backend",
      to: " ",
    })
    expect(blank.status).toBe(422)

    const renamed = await post(router, routes.project.groups.rename.href({ project }), {
      from: "Backend",
      to: "Server",
    })
    expect(renamed.status).toBe(303)
    const after = await fetchApp(router, routes.project.board.href({ project }), {
      headers: { Cookie: cookieOf(renamed) },
    })
    expect(await after.text()).toContain("Renamed group Backend to Server.")
    expect((await titlesOf(hubRuntime, project)).map((section) => section.name)).toEqual([
      undefined,
      "Server",
      "Ops",
    ])

    const missing = await fetchApp(
      router,
      routes.project.groups.edit.href({ project }, { searchParams: { name: "Nope" } }),
    )
    expect(missing.status).toBe(400)
  })

  test("hides move, and rename without reorder and renameGroup", async () => {
    const { router, hubRuntime, project } = await openWith({ reorder: false, renameGroup: false })
    const [one] = await seedThree(hubRuntime, project)
    const board = await (await fetchApp(router, routes.project.board.href({ project }))).text()
    const page = await (
      await fetchApp(router, routes.project.tasks.show.href({ project, id: required(one?.id) }))
    ).text()
    expect(board).not.toContain('class="moves"')
    expect(board).not.toContain(routes.project.groups.edit.href({ project }))
    expect(page).not.toContain(
      `action="${routes.project.tasks.move.href({ project, id: required(one?.id) })}"`,
    )
    expect(page).not.toContain('commandfor="move-task"')
    expect(page).not.toContain('id="move-task"')
    const edit = await fetchApp(
      router,
      routes.project.groups.edit.href({ project }, { searchParams: { name: "Backend" } }),
    )
    expect(edit.status).toBe(400)
  })

  test("renders move form inline on 422 validation error", async () => {
    const { router, hubRuntime, project } = await open()
    const [one] = await seedThree(hubRuntime, project)
    const response = await post(
      router,
      routes.project.tasks.move.href({ project, id: required(one?.id) }),
      {
        group: "__new__",
        newGroup: "",
      },
    )
    expect(response.status).toBe(422)
    const html = await response.text()
    expect(html).toContain("New group is required")
    expect(html).toContain(
      `action="${routes.project.tasks.move.href({ project, id: required(one?.id) })}"`,
    )
  })
})
