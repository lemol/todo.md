import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { scratchDirectory } from "../sandbox.ts"
import "../../src/web/load.ts"

test("the JSX loader keeps the source's line numbers in stack traces", async () => {
  const dir = scratchDirectory("todo-md-load-")
  const file = join(dir, "thrower.tsx")

  writeFileSync(file, "export const ok = 1\nexport const boom = new Error('boom')\n")

  const { boom } = (await import(file)) as { boom: Error }

  expect(boom.stack).toContain("thrower.tsx:2:")
})
