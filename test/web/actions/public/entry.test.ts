import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

test("entry.ts only reacts to changed/synced events for its own project", () => {
  const source = readFileSync(
    resolve(import.meta.dir, "../../../../src/web/app/actions/public/entry.ts"),
    "utf8",
  )
  expect(source).toContain("data-project")
  expect(source).toContain('addEventListener("changed"')
  expect(source).toContain('addEventListener("synced"')
})
