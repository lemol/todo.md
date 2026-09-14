import { basename, dirname, relative, resolve } from "node:path"
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

// Resolve the directory the asset server should mount as `npm`. Bun may hoist
// remix into a central store (`<ws>/node_modules/.bun/remix@<v>/node_modules`),
// where remix's own deps live in sibling store dirs outside the package dir —
// so mount the store root. In a local install (`<repo>/node_modules`) the
// neighbouring tree already holds everything, so mount it directly. Either way
// a single mount keeps the asset server's no-overlap check satisfied, and
// `allowPackages` still limits serving to remix and its dependencies.
export const serveRootFor = (npmRoot: string): string => {
  const storeDir = dirname(dirname(npmRoot))
  return basename(storeDir) === ".bun" ? storeDir : npmRoot
}

export const createAssets = (rootDir = resolve(import.meta.dir, "..")): AppAssets => {
  const remixPackageDir = dirname(fileURLToPath(import.meta.resolve("remix/package.json")))
  const npmRoot = dirname(remixPackageDir)
  const serveRoot = serveRootFor(npmRoot)
  return createAssetServer({
    rootDir,
    basePath: "/assets",
    mounts: { app: "app", npm: relative(rootDir, serveRoot) },
    allowFiles: ["app/routes.ts", "app/ui/styles.css", "app/actions/public/**", "app/**/public/**"],
    allowPackages: ["remix"],
    denyFiles: ["app/**/*.test.*"],
    watch: false,
  })
}
