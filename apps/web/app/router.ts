import { cop } from "remix/middleware/cop"
import { createRouter } from "remix/router"
import type { Capabilities } from "@lemol/todo-md/spec"
import type { TodoService } from "@lemol/todo-md/core"
import type { ListChanges } from "./middleware/changes.ts"
import { loadChanges } from "./middleware/changes.ts"
import { localOnly } from "./middleware/local.ts"
import { loadTodo, type TodoRuntime } from "./middleware/todo.ts"
import rootController from "./actions/controller.tsx"
import tasksController from "./actions/tasks/controller.tsx"
import { routes } from "./routes.ts"

export interface RouterOptions {
  readonly runtime: TodoRuntime
  readonly capabilities: Capabilities
  readonly changes: ListChanges
  readonly author: string
  readonly hosts: ReadonlyArray<string>
  readonly sessionSecret?: string
}

export const createAppRouter = (options: RouterOptions) => {
  const router = createRouter({
    middleware: [
      localOnly(options.hosts),
      cop(),
      loadTodo(options),
      loadChanges(options.changes),
    ],
  })
  router.map(routes, rootController)
  router.map(routes.tasks, tasksController)
  return Object.assign(router, { close: async () => undefined })
}
