import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"

test("temporary directories in tests use the sandbox helper", () => {
  const violations: string[] = []
  const prefix = "mk"
  const forbidden = new RegExp(`\\b${prefix}dtemp(?:Sync)?\\b`)

  for (const file of new Glob("**/*.{ts,tsx,js}").scanSync({ cwd: import.meta.dir })) {
    if (file === "sandbox.ts") continue

    const source = readFileSync(join(import.meta.dir, file), "utf8")

    if (forbidden.test(source)) violations.push(file)
  }

  expect(violations).toEqual([])
})
