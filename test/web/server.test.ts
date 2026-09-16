import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startServer } from "../../src/web/server.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

const base = { port: 0, host: "127.0.0.1", env: {}, username: "tester" }

test("starts over an unregistered --dir list and serves its board", async () => {
  const home = await mkdtemp(join(tmpdir(), "todo-md-home-"))
  const dir = await mkdtemp(join(tmpdir(), "todo-md-list-"))
  await writeFile(join(dir, "TODO.md"), "# Disk list\n")
  const started = await startServer({ ...base, cwd: dir, dir, home, userHome: home })
  cleanup.push(async () => {
    await started.close()
    await rm(home, { recursive: true, force: true })
    await rm(dir, { recursive: true, force: true })
  })
  const response = await fetch(`http://127.0.0.1:${started.port}/`, { redirect: "manual" })
  expect(response.status).toBe(302)
  const location = response.headers.get("location") ?? ""
  expect(location).toMatch(/^\/p\/.+/)
  const board = await fetch(`http://127.0.0.1:${started.port}${location}`)
  expect(board.status).toBe(200)
  expect(await board.text()).toContain("Disk list")
})

test("starts over a registered fs project by name", async () => {
  const home = await mkdtemp(join(tmpdir(), "todo-md-home-"))
  const dir = await mkdtemp(join(tmpdir(), "todo-md-list-"))
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
  const response = await fetch(`http://127.0.0.1:${started.port}/`, { redirect: "manual" })
  expect(response.headers.get("location")).toBe("/p/acme")
  expect(started.project).toBe("acme")
})

test("throws with the standard message when no list is found and no project is given", async () => {
  const home = await mkdtemp(join(tmpdir(), "todo-md-home-"))
  const cwd = await mkdtemp(join(tmpdir(), "todo-md-empty-"))
  cleanup.push(async () => {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })
  await expect(startServer({ ...base, cwd, home, userHome: home })).rejects.toThrow(
    "no todo.md list found",
  )
})
