import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { watchList } from "../watch.ts"

const roots: Array<string> = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

test("debounces list writes and ignores lock and temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "todo-md-watch-"))
  roots.push(root)
  await mkdir(join(root, "tasks"))
  const changes = watchList(root)
  let emissions = 0
  changes.subscribe(() => {
    emissions += 1
  })

  await writeFile(join(root, "tasks", "01-one.md"), "one")
  await writeFile(join(root, "tasks", "01-one.md"), "two")
  await wait(250)
  expect(emissions).toBe(1)

  await writeFile(join(root, ".todo.lock"), "lock")
  await writeFile(join(root, "ignored.tmp"), "temp")
  await wait(250)
  expect(emissions).toBe(1)
  changes.close()
})
