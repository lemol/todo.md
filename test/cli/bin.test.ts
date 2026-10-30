import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { scratchDirectory } from "../sandbox.ts"

// The real executable, as a separate process: exit codes and output streams.
const bin = join(import.meta.dir, "../../src/cli/bin.ts")
const dir = scratchDirectory("todo-md-bin-")

afterAll(() => rmSync(dir, { recursive: true, force: true }))

// The binary reads its home from the environment, so the child gets a home of
// its own. Inheriting the machine's would register every real project, and a
// command naming one would edit a backlog this test knows nothing about.
const run = (...args: string[]) => {
  const result = Bun.spawnSync(["bun", bin, ...args], {
    cwd: dir,
    env: {
      ...process.env,
      HOME: join(dir, "home"),
      TODO_MD_HOME: join(dir, "home", ".todo-md"),
      NO_COLOR: "1",
    },
  })

  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe("the todo executable", () => {
  test("reads its registry from the test's home, never the machine's", () => {
    expect(run("projects")).toMatchObject({
      code: 0,
      stdout: "No projects registered. Add one with `todo projects add <dir>`.\n",
    })
  })

  test("runs commands, exiting 0 on success, 1 on failure and 2 on usage errors", () => {
    expect(run("init", "--title", "Smoke")).toMatchObject({
      code: 0,
      stdout: "Created todo/TODO.md\n",
    })
    const added = run("add", "Try", "it", "--quick")

    expect(added.code).toBe(0)
    expect(added.stdout).toEndWith("/todo: Added 01  Try it\n")
    expect(run("next", "--json").stdout).toContain('"title":"Try it"')
    expect(run("done", "9")).toMatchObject({ code: 1, stdout: "", stderr: "error: no task 9\n" })
    expect(run("mv", "1").code).toBe(2)
    expect(run("--version").stdout).toContain("0.2.0")
  }, 15000)

  test("a bad registry is one error line, and --dir does not need it", () => {
    const scratch = scratchDirectory("alias-")
    const registryHome = join(scratch, "home", ".todo-md")
    const file = join(registryHome, "projects.yaml")

    mkdirSync(registryHome, { recursive: true })
    writeFileSync(file, "projects:\n  p: *a\n")
    writeFileSync(join(scratch, "TODO.md"), "# Good\n\n- [ ] 01 - First\n")

    const invoke = (...args: string[]) => {
      const result = Bun.spawnSync(["bun", bin, ...args], {
        cwd: scratch,
        env: {
          ...process.env,
          HOME: join(scratch, "home"),
          TODO_MD_HOME: registryHome,
          NO_COLOR: "1",
        },
      })

      return {
        code: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      }
    }

    expect(invoke("projects", "ls")).toEqual({
      code: 1,
      stdout: "",
      stderr: `error: ${file}: Unresolved alias (the anchor must be set before the alias): a\n`,
    })

    const listed = invoke("--dir", scratch, "list")

    expect(listed.code).toBe(0)
    expect(listed.stdout).toContain("First")
    expect(listed.stderr).toBe("")
  }, 15000)
})
