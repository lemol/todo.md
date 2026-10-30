import { afterAll, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { diskWith } from "../fs/helpers.ts"
import { scratchDirectory } from "../sandbox.ts"
import { todo } from "./harness.ts"

effectTest(
  "web --help describes the server and its flags",
  Effect.gen(function* () {
    const help = yield* todo("web", "--help")

    expect(help.code).toBe(0)
    expect(help.stdout).toContain("DESCRIPTION")
    expect(help.stdout).toContain("EXAMPLES")
    expect(help.stdout).toContain("--port")
    expect(help.stdout).toContain("--host")
  }),
  diskWith({}),
)

effectTest(
  "web rejects --project together with --dir",
  Effect.gen(function* () {
    const both = yield* todo("web", "--project", "acme", "--dir", "todo")

    expect(both.code).toBe(1)
    expect(both.stderr).toContain("use --project or --dir, not both")
  }),
  diskWith({}),
)

effectTest(
  "web rejects bad ports without serving",
  Effect.gen(function* () {
    const port = yield* todo("web", "--port", "0")

    expect(port.code).toBe(2)
    expect(port.stderr).toContain("port must be an integer from 1 to 65535")
    const json = yield* todo("web", "--port", "0", "--json")

    expect(json.code).toBe(2)
    expect(JSON.parse(json.stderr)).toMatchObject({ error: { tag: "UsageError" } })
  }),
  diskWith({}),
)

const source = resolve(import.meta.dir, "../../src/cli/bin.ts")
// Outside the repository: no tsconfig.json above it names the JSX runtime.
const scratch = scratchDirectory("todo-md-web-")

const env = {
  ...process.env,
  HOME: join(scratch, "home"),
  TODO_MD_HOME: join(scratch, "hub"),
  NO_COLOR: "1",
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

test("web from source renders the board outside the repository", async () => {
  for (const args of [
    ["init", "--title", "Web fixture"],
    ["add", "Ready task", "--quick"],
  ]) {
    const result = Bun.spawnSync([process.execPath, source, ...args], { cwd: scratch, env })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
  }

  const child = Bun.spawn([process.execPath, source, "web", "--port", "49170"], {
    cwd: scratch,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })

  const deadline = setTimeout(() => child.kill(), 10000)

  try {
    const first = await child.stdout.getReader().read()
    const output = new TextDecoder().decode(first.value)
    const url = output.match(/http:\/\/127\.0\.0\.1:\d+\/\S+/)?.[0]

    expect(url, url === undefined ? await new Response(child.stderr).text() : output).toBeDefined()

    const response = await fetch(url!, { signal: AbortSignal.timeout(5000) })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain("Ready task")
  } finally {
    clearTimeout(deadline)
    child.kill()
    await child.exited
  }
}, 15000)
