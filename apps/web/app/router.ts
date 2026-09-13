import type { Capabilities } from "@lemol/todo-md/spec"
import { createCookie } from "remix/cookie"
import { cop } from "remix/middleware/cop"
import { formData } from "remix/middleware/form-data"
import { session } from "remix/middleware/session"
import { createRouter } from "remix/router"
import { createMemorySessionStorage } from "remix/session-storage/memory"
import rootController from "./actions/controller.tsx"
import tasksController from "./actions/tasks/controller.tsx"
import { createAssets, loadAssets } from "./assets.ts"
import type { ListChanges } from "./middleware/changes.ts"
import { loadChanges } from "./middleware/changes.ts"
import { localOnly } from "./middleware/local.ts"
import { loadTodo, type TodoRuntime } from "./middleware/todo.ts"
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
  const assets = createAssets()
  const cookie = createCookie("todo-md-session", {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secrets: [options.sessionSecret ?? crypto.randomUUID() + crypto.randomUUID()],
  })
  const router = createRouter({
    middleware: [
      localOnly(options.hosts),
      cop(),
      loadAssets(assets),
      formData(),
      session(cookie, createMemorySessionStorage()),
      loadTodo(options),
      loadChanges(options.changes),
    ],
  })
  router.map(routes, rootController)
  router.map(routes.tasks, tasksController)
  return Object.assign(router, {
    close: async () => {
      await assets.close()
    },
  })
}
