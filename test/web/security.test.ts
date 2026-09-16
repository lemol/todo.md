import { expect, test } from "bun:test"
import { Effect } from "effect"
import { TodoService } from "../../src/core/index.ts"
import { TaskNotFound } from "../../src/spec/index.ts"
import { runTodo, taskId } from "../../src/web/app/middleware/todo.ts"
import { makeRouter } from "./harness.ts"

test("rejects foreign hosts, including the event stream", async () => {
  const { router, project, close } = await makeRouter()
  try {
    for (const path of [`/p/${project}`, "/events", "/", "/projects", "/go?project=acme"]) {
      const response = await router.fetch(
        new Request(`http://foreign.example${path}`, { headers: { Host: "foreign.example" } }),
      )
      expect(response.status).toBe(403)
    }
  } finally {
    await close()
  }
})

test("rejects cross-origin POSTs on every route", async () => {
  const { router, project, close } = await makeRouter()
  try {
    for (const path of [
      `/p/${project}/tasks`,
      `/p/${project}/sync`,
      "/sync",
      "/projects",
      "/projects/acme/rename",
      "/projects/acme/remove",
    ]) {
      const response = await router.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { Host: "localhost", Origin: "http://foreign.example" },
          body: new FormData(),
        }),
      )
      expect(response.status).toBe(403)
    }
  } finally {
    await close()
  }
})

test("maps typed failures but lets defects reject", async () => {
  const stub = {} as TodoService["Service"]
  const fakeRuntime = {
    runPromise: <A, E>(effect: Effect.Effect<A, E, TodoService>) =>
      Effect.runPromise(Effect.provideService(effect, TodoService, stub)),
  }
  const context = { get: () => fakeRuntime }
  const typed = await runTodo(context, () => Effect.fail(new TaskNotFound({ id: "7" })))
  expect(typed).toEqual({ ok: false, error: expect.any(TaskNotFound) })

  await expect(runTodo(context, () => Effect.die("boom"))).rejects.toBe("boom")
})

test("taskId strips leading zeros from numeric IDs only", () => {
  expect(taskId("007")).toBe("7")
  expect(taskId("PROJ-7")).toBe("PROJ-7")
})
