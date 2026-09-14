import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAssetServer } from "remix/assets"
import { assetOptions } from "../../src/web/app/assets.ts"

// `todo web` boots from wherever bun installed todo-md — including its
// central store, where the app dir sits *inside* the served tree and remix's
// dependencies live in sibling store entries outside any single node_modules.
// Building and compiling the asset server there must work (regressions: a
// store-root mount overlapped the app mount and boot crashed; an npm-only
// mount left sibling entries outside the mounts and the entry failed to
// compile with IMPORT_OUTSIDE_MOUNTS).
const layout = () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-assets-"))
  const remixDir = join(dir, ".bun", "remix@1", "node_modules", "remix")
  const leftpadDir = join(dir, ".bun", "leftpad@1", "node_modules", "leftpad")
  mkdirSync(join(remixDir, "node_modules"), { recursive: true })
  mkdirSync(leftpadDir, { recursive: true })
  writeFileSync(
    join(remixDir, "package.json"),
    JSON.stringify({
      name: "remix",
      version: "1.0.0",
      main: "index.js",
      dependencies: { leftpad: "1.0.0" },
    }),
  )
  writeFileSync(join(remixDir, "index.js"), 'export { pad } from "leftpad"\n')
  writeFileSync(
    join(leftpadDir, "package.json"),
    JSON.stringify({ name: "leftpad", version: "1.0.0", main: "index.js" }),
  )
  writeFileSync(join(leftpadDir, "index.js"), "export const pad = (s) => s\n")
  // Bun links an isolated entry's dependencies from the store: the resolved
  // file lives in the sibling entry, outside the npm mount.
  symlinkSync(leftpadDir, join(remixDir, "node_modules", "leftpad"))
  const todoDir = join(dir, ".bun", "todo@1", "node_modules", "todo")
  mkdirSync(join(dir, ".bun", "todo@1", "node_modules"), { recursive: true })
  symlinkSync(remixDir, join(dir, ".bun", "todo@1", "node_modules", "remix"))
  const rootDir = join(todoDir, "src", "web")
  mkdirSync(join(rootDir, "app", "actions", "public"), { recursive: true })
  writeFileSync(join(rootDir, "app", "routes.ts"), "export const routes = {}\n")
  writeFileSync(
    join(rootDir, "app", "actions", "public", "entry.ts"),
    'import { pad } from "remix"\nconsole.log(pad("ok"))\n',
  )
  return { rootDir, remixDir }
}

test("builds the asset server inside a bun store layout", async () => {
  const { rootDir, remixDir } = layout()
  const server = createAssetServer(assetOptions(rootDir, remixDir))
  await server.close()
})

test("compiles an entry importing through a sibling store entry", async () => {
  const { rootDir, remixDir } = layout()
  const server = createAssetServer(assetOptions(rootDir, remixDir))
  try {
    const entry = await server.getScriptEntry("app/actions/public/entry.ts")
    expect(entry.href).toMatch(/\/assets\//)
    expect(entry.preloads.length).toBeGreaterThan(0)
    expect((await server.fetch(new Request(`http://localhost${entry.href}`)))?.status).toBe(200)
  } finally {
    await server.close()
  }
})
