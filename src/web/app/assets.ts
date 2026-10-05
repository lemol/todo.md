import { readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join, relative, resolve } from "node:path"
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

// The nearest node_modules above a package dir.
const containerOf = (packageDir: string): string => {
  let dir = packageDir

  while (basename(dir) !== "node_modules") {
    const parent = dirname(dir)

    if (parent === dir) throw new Error(`no node_modules above ${packageDir}`)

    dir = parent
  }

  return dir
}

/**
 * Every node_modules tree holding remix or one of its transitive
 * dependencies. Package discovery walks up from these the way node itself
 * resolves, so the set is complete in every layout: a local install
 * collapses to one tree, while bun's store contributes one per entry.
 */
export const packageContainers = (remixPackageDir: string): ReadonlyArray<string> => {
  const containers = new Set<string>()
  const seen = new Set<string>()

  const visit = (packageDir: string) => {
    const real = realpathSync(packageDir)

    if (seen.has(real)) return

    seen.add(real)
    containers.add(containerOf(real))
    const pkg = JSON.parse(readFileSync(join(real, "package.json"), "utf8")) as {
      dependencies?: Readonly<Record<string, string>>
      optionalDependencies?: Readonly<Record<string, string>>
    }

    const require = createRequire(join(real, "package.json"))

    for (const dep of [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]) {
      try {
        visit(dirname(require.resolve(`${dep}/package.json`)))
      } catch {
        // Unresolvable here: the server's own discovery reports it.
      }
    }
  }

  visit(remixPackageDir)

  return [...containers]
}

// The asset server's options from the app dir and the loaded remix copy.
// Every container is mounted: the compiler reads remix and its dependencies
// wherever the install put them, while `allowPackages` still limits serving
// to that closure. Mounting anything above the trees — e.g. the store root —
// overlaps the `app` mount, and the server refuses to boot.
export const assetOptions = (rootDir: string, remixPackageDir: string, uiPackageDir?: string) => {
  // Canonicalize: the server realpaths the root before resolving mounts, so
  // mounts computed from a symlinked root (a symlinked checkout, macOS tmp)
  // would point nowhere. Containers already come back canonical.
  const base = realpathSync(rootDir)
  const mounts: Record<string, string> = { app: "app" }
  const containers = [
    ...packageContainers(remixPackageDir),
    ...(uiPackageDir ? packageContainers(uiPackageDir) : []),
  ]

  const uniqueContainers = [...new Set(containers)]

  uniqueContainers.forEach((dir, index) => {
    mounts[index === 0 ? "npm" : `npm${index + 1}`] = relative(base, dir)
  })

  return {
    rootDir: base,
    basePath: "/assets",
    mounts,
    allowFiles: ["app/routes.ts", "app/actions/public/**", "app/**/public/**"],
    allowPackages: ["remix", "@lemol/ui"],
    denyFiles: ["app/**/*.test.*"],
    watch: false,
  }
}

export const createAssets = (rootDir = resolve(import.meta.dir, "..")): AppAssets => {
  const remixPackageDir = dirname(fileURLToPath(import.meta.resolve("remix/package.json")))
  const uiPackageDir = dirname(fileURLToPath(import.meta.resolve("@lemol/ui/package.json")))

  return createAssetServer(assetOptions(rootDir, remixPackageDir, uiPackageDir))
}
