#!/usr/bin/env bun
// Bundles src/cli/bin.ts into an executable dist/bin.js for the installed
// `todo` bin. The web server stays outside the bundle: createAssets locates
// source assets relative to its own module, so bundling the server would
// point asset discovery at dist/ instead of src/web. The native resolver
// (oxc-resolver) stays outside too, keeping the bundle portable.

import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"

const root = resolve(import.meta.dir, "..")
const outdir = process.argv[2] === undefined ? join(root, "dist") : resolve(process.argv[2])

const entrypoint = join(root, "src/cli/bin.ts")
const server = join(root, "src/web/server.ts")

const toPosix = (path: string): string => path.split(sep).join("/")

const serverPlugin: Bun.Plugin = {
  name: "todo-md-external-web-server",

  setup(build) {
    // The CLI loads the server lazily with import("../../web/server.ts");
    // leave that specifier external, rewritten relative to the output
    // directory, so the bundle loads the server from the installed package.
    build.onResolve({ filter: /^\.\.\/\.\.\/web\/server\.ts$/ }, () => {
      const specifier = toPosix(relative(outdir, server))

      return { path: specifier.startsWith(".") ? specifier : `./${specifier}`, external: true }
    })
  },
}

const result = await Bun.build({
  entrypoints: [entrypoint],
  outdir,
  target: "bun",
  minify: true,
  external: ["oxc-resolver"],
  plugins: [serverPlugin],
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
