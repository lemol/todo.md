import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"

// Hash contents and the file list, rather than mtimes: checkout and restore
// operations may preserve timestamps, and removed inputs must invalidate too.
export const fingerprint = (root: string): string => {
  const files = [
    "package.json",
    "bun.lock",
    "tsconfig.json",
    "scripts/build-cli.ts",
    "bin/todo.ts",
    "bin/freshness.ts",
  ]

  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`

      if (entry.isDirectory()) walk(path)
      else files.push(path)
    }
  }

  walk("src")
  const hash = createHash("sha256").update(Bun.version)

  for (const path of files.sort()) {
    hash
      .update(path)
      .update("\0")
      .update(readFileSync(join(root, path)))
      .update("\0")
  }

  return hash.digest("hex")
}

export const bundleIsCurrent = (root: string): boolean => {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "dist/freshness.json"), "utf8"))

    if (
      !Array.isArray(manifest.outputs) ||
      !manifest.outputs.includes("bin.js") ||
      !manifest.outputs.every(
        (name: unknown) =>
          typeof name === "string" &&
          basename(name) === name &&
          name.endsWith(".js") &&
          existsSync(join(root, "dist", name)),
      )
    ) {
      return false
    }

    return manifest.fingerprint === fingerprint(root)
  } catch {
    // Missing/old metadata, a partial build or unreadable inputs use source.
    return false
  }
}
