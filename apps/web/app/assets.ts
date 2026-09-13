import { createAssetServer } from "remix/assets"
import { createContextKey, type Middleware } from "remix/router"

export interface AppAssets {
  readonly getScriptEntry: (path: string) => Promise<{ readonly href: string }>
  readonly fetch: (request: Request) => Promise<Response | undefined>
  readonly close: () => Promise<void>
}

export const assetsContext = createContextKey<AppAssets>()
export const loadAssets =
  (assets: AppAssets): Middleware =>
  (context, next) => {
    context.set(assetsContext, assets)
    return next()
  }

export const createAssets = (rootDir = import.meta.dir.replace(/\/app$/, "")): AppAssets => {
  const server = createAssetServer({
    rootDir,
    basePath: "/assets",
    allowFiles: ["app/routes.ts", "app/ui/styles.css", "app/actions/public/**", "app/**/public/**"],
    allowPackages: ["remix"],
    denyFiles: ["app/**/*.test.*"],
    watch: false,
  })
  return {
    getScriptEntry: (path) => server.getScriptEntry(path),
    fetch: async (request) => (await server.fetch(request)) ?? undefined,
    close: async () => {
      await server.close()
    },
  }
}
