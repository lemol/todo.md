import { expect, test } from "bun:test"
import { Effect } from "effect"
import { TaskNotFound } from "../../src/spec/index.ts"
import { runTodo, taskId } from "../../src/web/app/middleware/todo.ts"
import { routes } from "../../src/web/app/routes.ts"
import { makeRouter, makeRuntime } from "./harness.ts"

test("rejects foreign hosts, including the event stream", async () => {
  const router = makeRouter()
  for (const path of [routes.board.href(), routes.events.href()]) {
    const response = await router.fetch(
      new Request(`http://foreign.example${path}`, {
        headers: { Host: "foreign.example" },
      }),
    )
    expect(response.status).toBe(403)
  }
})

test("rejects cross-origin POSTs", async () => {
  const router = makeRouter()
  const response = await router.fetch(
    new Request(`http://localhost${routes.tasks.add.href()}`, {
      method: "POST",
      headers: { Host: "localhost", Origin: "http://foreign.example" },
      body: new FormData(),
    }),
  )
  expect(response.status).toBe(403)
})

test("maps typed failures but lets defects reject", async () => {
  const runtime = makeRuntime()
  const context = { get: () => runtime }
  const typed = await runTodo(context, () => Effect.fail(new TaskNotFound({ id: "7" })))
  expect(typed).toEqual({ ok: false, error: expect.any(TaskNotFound) })

  await expect(runTodo(context, () => Effect.die("boom"))).rejects.toBe("boom")
})

test("normalizes padded task IDs", () => {
  expect(taskId("007")).toBe("7")
})
