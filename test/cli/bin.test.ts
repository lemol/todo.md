import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The real executable, as a separate process: exit codes and output streams.
const bin = join(import.meta.dir, "../../src/cli/bin.ts")
const dir = mkdtempSync(join(tmpdir(), "todo-md-bin-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const run = (...args: string[]) => {
  const result = Bun.spawnSync(["bun", bin, ...args], {
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1" },
  })
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe("the todo executable", () => {
  test("runs commands, exiting 0 on success, 1 on failure and 2 on usage errors", () => {
    expect(run("init", "--title", "Smoke")).toMatchObject({
      code: 0,
      stdout: "Created todo/TODO.md\n",
    })
    expect(run("add", "Try", "it", "--quick")).toMatchObject({
      code: 0,
      stdout: "Added 01  Try it\n",
    })
    expect(run("next", "--json").stdout).toContain('"title":"Try it"')
    expect(run("done", "9")).toMatchObject({ code: 1, stdout: "", stderr: "error: no task 9\n" })
    expect(run("mv", "1").code).toBe(2)
    expect(run("--version").stdout).toContain("0.1.0")
  })
})
