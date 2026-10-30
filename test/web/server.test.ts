import { afterEach, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startServer } from "../../src/web/server.ts"
import { scratchDirectory } from "../sandbox.ts"

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

const base = { port: 0, host: "127.0.0.1", env: {}, username: "tester" }

test("starts over an unregistered --dir list and serves its board", async () => {
  const home = scratchDirectory("todo-md-home-")
  const dir = scratchDirectory("todo-md-list-")

  await writeFile(join(dir, "TODO.md"), "# Disk list\n")
  const started = await startServer({ ...base, cwd: dir, dir, home, userHome: home })

  cleanup.push(async () => {
    await started.close()
    await rm(home, { recursive: true, force: true })
    await rm(dir, { recursive: true, force: true })
  })
  const dashboard = await fetch(`http://127.0.0.1:${started.port}/`)

  expect(dashboard.status).toBe(200)
  expect(await dashboard.text()).toContain("Disk list")
  const board = await fetch(`http://127.0.0.1:${started.port}/p/${started.project}`)

  expect(board.status).toBe(200)
  expect(await board.text()).toContain("Disk list")
})

test("starts over a registered fs project by name", async () => {
  const home = scratchDirectory("todo-md-home-")
  const dir = scratchDirectory("todo-md-list-")

  await writeFile(join(dir, "TODO.md"), "# Registered list\n")
  await mkdir(join(home, "projects", "acme"), { recursive: true })
  await writeFile(
    join(home, "projects.yaml"),
    `projects:\n  acme:\n    source: fs\n    path: ${dir}\n`,
  )
  const started = await startServer({ ...base, cwd: home, project: "acme", home, userHome: home })

  cleanup.push(async () => {
    await started.close()
    await rm(home, { recursive: true, force: true })
    await rm(dir, { recursive: true, force: true })
  })
  const dashboard = await fetch(`http://127.0.0.1:${started.port}/`)

  expect(dashboard.status).toBe(200)
  expect(await dashboard.text()).toContain("Registered list")
  expect(started.project).toBe("acme")
})

test("rejects --project together with --dir", async () => {
  const home = scratchDirectory("todo-md-home-")
  const cwd = scratchDirectory("todo-md-empty-")

  cleanup.push(async () => {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })
  await expect(
    startServer({ ...base, cwd, dir: cwd, project: "acme", home, userHome: home }),
  ).rejects.toThrow("use --project or --dir, not both")
})

test("throws with the standard message when no list is found and no project is given", async () => {
  const home = scratchDirectory("todo-md-home-")
  const cwd = scratchDirectory("todo-md-empty-")

  cleanup.push(async () => {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })
  await expect(startServer({ ...base, cwd, home, userHome: home })).rejects.toThrow(
    "no todo.md list found",
  )
})
