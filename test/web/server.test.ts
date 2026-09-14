import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { resolveRoot } from "../../src/web/server.ts"

const base = { port: 4400, host: "127.0.0.1", env: {}, username: "tester" }

test("resolveRoot resolves --dir against the working directory", async () => {
  const root = await resolveRoot({ ...base, cwd: join("tmp", "work"), dir: "todo" })
  expect(root).toBe(resolve(join("tmp", "work"), "todo"))
})

test("resolveRoot discovers the checkout's own list", async () => {
  const root = await resolveRoot({ ...base, cwd: resolve(import.meta.dir, "..", "..") })
  expect(root.endsWith("todo")).toBe(true)
})

test("resolveRoot without a list throws the standard message", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "todo-md-empty-"))
  try {
    await expect(resolveRoot({ ...base, cwd })).rejects.toThrow("no todo.md list found")
  } finally {
    await rm(cwd, { recursive: true })
  }
})
