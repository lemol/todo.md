import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createAssetServer, type ScriptEntry } from "remix/assets"
import { createContextKey, type Middleware } from "remix/router"

export interface AppAssets {
  readonly getScriptEntry: (path: string) => Promise<ScriptEntry>
  readonly fetch: (request: Request) => Promise<Response | null>
  readonly close: () => Promise<void>
}

export const assetsContext = createContextKey<AppAssets>()
export const loadAssets =
  (assets: AppAssets): Middleware =>
  (context, next) => {
    context.set(assetsContext, assets)
    return next()
  }

export const createAssets = (rootDir = resolve(import.meta.dir, "..")): AppAssets => {
  const remixPackageDir = dirname(fileURLToPath(import.meta.resolve("remix/package.json")))
  const bunStoreDir = dirname(dirname(dirname(remixPackageDir)))
  return createAssetServer({
    rootDir,
    basePath: "/assets",
    mounts: { app: "app", npm: relative(rootDir, bunStoreDir) },
    allowFiles: ["app/routes.ts", "app/ui/styles.css", "app/actions/public/**", "app/**/public/**"],
    allowPackages: ["remix"],
    denyFiles: ["app/**/*.test.*"],
    watch: false,
  })
}
