import { createController } from "remix/router"
import type { RequestContext } from "remix/router"
import { TodoService } from "@lemol/todo-md/core"
import { runTodo, todoRuntimeContext, type TodoRuntime } from "../middleware/todo.ts"
import { routes } from "../routes.ts"

const board = async (context: RequestContext<any, any>) => {
  try {
    const result = await runTodo(
      context as { readonly get: (key: typeof todoRuntimeContext) => TodoRuntime },
      (todo) => todo.list(),
    )
    if (!result.ok) return new Response("Todo store failure", { status: 500 })
    return new Response(`<main><h1>${result.value.title}</h1></main>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (defect) {
    return new Response(String(defect), { status: 500 })
  }
}

export default createController(routes, {
  actions: {
    board,
    done: () => new Response("Done"),
    check: () => new Response("Check"),
    events: () => new Response("Events"),
    assets: () => new Response("Not Found", { status: 404 }),
  },
})
