import { afterAll, beforeAll, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "../..")
const scratch = mkdtempSync(join(tmpdir(), "todo-md-bundle-"))
const outdir = join(scratch, "dist")
const source = join(root, "src/cli/bin.ts")
const bundled = join(outdir, "bin.js")
const installed = join(scratch, "bin/todo")
const env = {
  ...process.env,
  HOME: join(scratch, "home"),
  TODO_MD_HOME: join(scratch, "hub"),
  NO_COLOR: "1",
}

const run = (entry: string, ...args: string[]) => {
  const result = Bun.spawnSync([process.execPath, entry, ...args], { cwd: scratch, env })

  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

beforeAll(() => {
  const build = Bun.spawnSync([process.execPath, "scripts/build-cli.ts", outdir], {
    cwd: root,
    env,
  })

  expect(build.exitCode, build.stderr.toString()).toBe(0)
  mkdirSync(join(scratch, "bin"))
  symlinkSync(bundled, installed)

  for (const args of [
    ["init", "--title", "Bundle fixture"],
    ["add", "Ready task", "--quick"],
    ["add", "Completed task", "--quick"],
    ["done", "2"],
    ["projects", "add", join(scratch, "todo"), "--name", "bundle"],
    ["init", join(scratch, "unregistered"), "--title", "Unregistered fixture"],
  ]) {
    expect(run(source, ...args).code).toBe(0)
  }
}, 15000)

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

test("installs the bundle and builds it in prepare", async () => {
  const pkg = await Bun.file(join(root, "package.json")).json()

  expect(pkg.bin.todo).toBe("./dist/bin.js")
  expect(pkg.scripts["build:cli"]).toBe("bun scripts/build-cli.ts")
  expect(pkg.scripts.prepare).toBe("bun run build:cli")
  expect(readdirSync(outdir)).toContain("bin.js")
  expect(readdirSync(outdir).every((name) => name.endsWith(".js"))).toBe(true)
  expect(await Bun.file(bundled).text()).toStartWith("#!/usr/bin/env bun")
  const help = Bun.spawnSync([installed, "--help"], { cwd: scratch, env })

  expect(help.exitCode, help.stderr.toString()).toBe(0)
  expect(help.stdout.toString()).toBe(run(source, "--help").stdout)
})

test("help does not load the external web assets module", () => {
  // Relocating only generated files breaks the relative source-assets import.
  // Help still works: only `web` may load that module and its dependencies.
  const relocated = join(scratch, "relocated", "deeper", "dist")

  cpSync(outdir, relocated, { recursive: true })
  expect(run(join(relocated, "bin.js"), "--help")).toEqual(run(source, "--help"))
})

for (const args of [["ls"], ["next", "--json"], ["ls", "--all"]]) {
  test(`bundle matches source for ${args.join(" ")}`, () => {
    const expected = run(source, ...args)

    expect(expected.code).toBe(0)
    expect(expected.stderr).toBe("")
    expect(expected.stdout).toContain("Ready task")
    expect(run(bundled, ...args)).toEqual(expected)
  })
}

for (const scenario of [
  { name: "default registered list", args: [], cwd: scratch },
  { name: "explicit registered project", args: ["--project", "bundle"], cwd: scratch },
  { name: "unregistered cwd", args: [], cwd: join(scratch, "unregistered") },
  {
    name: "explicit unregistered dir",
    args: ["--dir", join(scratch, "unregistered")],
    cwd: scratch,
  },
]) {
  test(`bundle serves web with a registered project present: ${scenario.name}`, async () => {
    const child = Bun.spawn([installed, "web", ...scenario.args, "--port", "49152"], {
      cwd: scenario.cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    })

    const deadline = setTimeout(() => child.kill(), 10000)

    try {
      const first = await child.stdout.getReader().read()
      const output = new TextDecoder().decode(first.value)
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+\/\S+/)?.[0]

      expect(
        url,
        url === undefined ? await new Response(child.stderr).text() : output,
      ).toBeDefined()
      const response = await fetch(url!, { signal: AbortSignal.timeout(5000) })

      expect(response.status).toBe(200)
      expect((await response.text()).length).toBeGreaterThan(0)
    } finally {
      clearTimeout(deadline)
      child.kill()
      await child.exited
    }
  }, 15000)
}

test.skipIf(process.env.TODO_CLI_BENCHMARK !== "1")(
  "warm installed help is under 80 ms, best of five",
  () => {
    const measure = () => {
      const start = performance.now()
      const result = Bun.spawnSync([installed, "--help"], { cwd: scratch, env })

      expect(result.exitCode, result.stderr.toString()).toBe(0)

      return performance.now() - start
    }

    measure()
    const best = Math.min(...Array.from({ length: 5 }, measure))

    console.log(`warm installed help best-of-5: ${best.toFixed(2)} ms`)
    expect(best).toBeLessThan(80)
  },
)
