#!/usr/bin/env bun
// Bundles src/cli/bin.ts into an executable dist/bin.js for the installed
// `todo` bin. Web is a lazy chunk sharing the CLI's Effect runtime; passing
// schemas between bundled and installed runtimes is unsafe. Asset discovery
// stays in its source module so createAssets finds src/web, not dist/.
// The native resolver (oxc-resolver) stays outside, keeping output portable.

import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"

const root = resolve(import.meta.dir, "..")
const outdir = process.argv[2] === undefined ? join(root, "dist") : resolve(process.argv[2])

const entrypoint = join(root, "src/cli/bin.ts")
const assets = join(root, "src/web/app/assets.ts")

const toPosix = (path: string): string => path.split(sep).join("/")

// The bundle resolves external assets against its real location, so
// relativize canonical paths: a symlinked outdir (macOS /tmp) would
// otherwise miscount the `..` climb and miss the module at runtime.
mkdirSync(outdir, { recursive: true })

const canonical = (path: string): string => toPosix(realpathSync(path))

const assetsPlugin: Bun.Plugin = {
  name: "todo-md-external-web-assets",

  setup(build) {
    build.onResolve({ filter: /\/assets\.ts$/ }, (args) => {
      if (resolve(args.resolveDir, args.path) !== assets) return

      const specifier = relative(canonical(outdir), canonical(assets))

      return { path: specifier.startsWith(".") ? specifier : `./${specifier}`, external: true }
    })
  },
}

const result = await Bun.build({
  entrypoints: [entrypoint],
  outdir,
  target: "bun",
  minify: true,
  splitting: true,
  external: ["oxc-resolver"],
  plugins: [assetsPlugin],
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }

  process.exit(1)
}

const out = join(outdir, "bin.js")
const content = readFileSync(out, "utf8")

if (!content.startsWith("#!/usr/bin/env bun")) {
  writeFileSync(out, `#!/usr/bin/env bun\n${content}`)
}

chmodSync(out, 0o755)
