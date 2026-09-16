import { createCookie } from "remix/cookie"
import { cop } from "remix/middleware/cop"
import { formData } from "remix/middleware/form-data"
import { render } from "remix/middleware/render"
import { session } from "remix/middleware/session"
import { createRouter } from "remix/router"
import { createMemorySessionStorage } from "remix/session-storage/memory"
import { createRootController, createTopController } from "./actions/controller.tsx"
import { createGroupsController } from "./actions/groups/controller.tsx"
import { createProjectsController } from "./actions/projects/controller.tsx"
import { createTasksController } from "./actions/tasks/controller.tsx"
import { type AppAssets, createAssets, loadAssets } from "./assets.ts"
import { loadAssetEntry } from "./middleware/assets.ts"
import { localOnly } from "./middleware/local.ts"
import type { HubRuntime } from "./middleware/project.tsx"
import { provideHub } from "./middleware/project.tsx"
import { routes } from "./routes.ts"

export interface RouterOptions {
  readonly runtime: HubRuntime
  readonly author: string
  readonly hosts: ReadonlyArray<string>
  /** Resolves relative paths in the add-project form. */
  readonly cwd: string
  /** The startup project's name; shown first on the dashboard when unregistered. */
  readonly startup: string
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
      loadAssetEntry(assets),
      render({ assets }),
      provideHub(options.runtime),
    ],
  })
  const controllerOptions = { runtime: options.runtime, author: options.author }
  router.map(
    routes.projects,
    createProjectsController({ runtime: options.runtime, cwd: options.cwd }),
  )
  router.map(routes.project, createRootController(controllerOptions))
  router.map(routes.project.tasks, createTasksController(controllerOptions))
  router.map(routes.project.groups, createGroupsController(controllerOptions))
  router.map(routes, createTopController({ runtime: options.runtime, startup: options.startup }))
  return Object.assign(router, {
    close: async () => {
      await assets.close()
    },
  })
}
