import type { Capabilities } from "@lemol/todo-md/spec"
import { createCookie } from "remix/cookie"
import { cop } from "remix/middleware/cop"
import { formData } from "remix/middleware/form-data"
import { render } from "remix/middleware/render"
import { session } from "remix/middleware/session"
import { createRouter } from "remix/router"
import { createMemorySessionStorage } from "remix/session-storage/memory"
import rootController from "./actions/controller.tsx"
import groupsController from "./actions/groups/controller.tsx"
import tasksController from "./actions/tasks/controller.tsx"
import { type AppAssets, createAssets, loadAssets } from "./assets.ts"
import { loadAssetEntry } from "./middleware/assets.ts"
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
  readonly assets?: AppAssets
}

export const createAppRouter = (options: RouterOptions) => {
  const assets = options.assets ?? createAssets()
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
      loadAssetEntry(assets),
      render({ assets }),
    ],
  })
  router.map(routes, rootController)
  router.map(routes.tasks, tasksController)
  router.map(routes.groups, groupsController)
  return Object.assign(router, {
    close: async () => {
      await assets.close()
    },
  })
}
