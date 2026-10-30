import { afterAll, beforeAll, expect, test } from "bun:test"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "../..")
const scratch = mkdtempSync(join(tmpdir(), "todo-md-bundle-"))
const packageDir = join(scratch, "package")
const outdir = join(packageDir, "dist")
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

const checkout = (dir = mkdtempSync(join(scratch, "checkout-"))) => {
  mkdirSync(dir, { recursive: true })

  for (const path of ["src", "scripts", "bin", "package.json", "bun.lock", "tsconfig.json"]) {
    if (existsSync(join(root, path))) cpSync(join(root, path), join(dir, path), { recursive: true })
  }

  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"))

  return dir
}

const buildCheckout = (dir: string) => {
  const result = Bun.spawnSync([process.execPath, join(dir, "scripts/build-cli.ts")], {
    cwd: scratch,
    env,
  })

  expect(result.exitCode, result.stderr.toString()).toBe(0)
}

const linkCheckout = (dir: string) => {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  const link = join(dir, "node_modules-bin-todo")

  symlinkSync(join(dir, pkg.bin.todo), link)

  return link
}

test("installed entry runs source without dist", () => {
  const dir = checkout()
  const entry = linkCheckout(dir)

  expect(existsSync(join(dir, "dist"))).toBe(false)
  expect(run(entry, "--help")).toEqual(run(source, "--help"))
})

test("rebuilding after removing a lazy entry removes obsolete chunks", () => {
  const dir = checkout()
  const entry = join(dir, "src/cli/bin.ts")
  const lazy = join(dir, "src/cli/lazy.ts")

  writeFileSync(entry, 'console.log((await import("./lazy.ts")).value)\n')
  writeFileSync(lazy, 'export const value = "lazy"\n')
  buildCheckout(dir)
  const oldChunks = readdirSync(join(dir, "dist")).filter(
    (name) => name !== "bin.js" && name.endsWith(".js"),
  )

  expect(oldChunks.length).toBeGreaterThan(0)
  writeFileSync(entry, 'console.log("rebuilt")\n')
  rmSync(lazy)
  buildCheckout(dir)

  for (const chunk of oldChunks) expect(existsSync(join(dir, "dist", chunk))).toBe(false)

  expect(run(linkCheckout(dir))).toEqual({ code: 0, stdout: "rebuilt\n", stderr: "" })
})

for (const change of [
  "edit",
  "add",
  "remove",
  "lockfile",
  "missing metadata",
  "invalid metadata",
  "missing chunk",
]) {
  test(`installed entry falls back to current source: ${change}`, () => {
    const dir = checkout()
    const entry = join(dir, "src/cli/bin.ts")
    const extra = join(dir, "src/cli/extra.ts")

    writeFileSync(
      entry,
      'await import("./lazy.ts"); console.log("current", ...process.argv.slice(2)); process.exitCode = 7\n',
    )
    writeFileSync(join(dir, "src/cli/lazy.ts"), 'export const value = "lazy"\n')
    writeFileSync(extra, "// present at build time\n")
    buildCheckout(dir)
    // Make bundle selection observable without altering any build inputs.
    writeFileSync(join(dir, "dist/bin.js"), 'console.log("bundle")\n')

    switch (change) {
      case "edit":
        writeFileSync(extra, "// changed after building\n")
        utimesSync(extra, new Date(0), new Date(0))
        break
      case "add":
        writeFileSync(join(dir, "src/cli/new.ts"), "// new input\n")
        break
      case "remove":
        rmSync(extra)
        break
      case "lockfile":
        writeFileSync(join(dir, "bun.lock"), "changed lockfile\n")
        break
      case "missing metadata":
        rmSync(join(dir, "dist/freshness.json"), { force: true })
        break
      case "invalid metadata":
        writeFileSync(join(dir, "dist/freshness.json"), "{}")
        break
      case "missing chunk":
        rmSync(
          join(
            dir,
            "dist",
            readdirSync(join(dir, "dist")).find(
              (name) => name !== "bin.js" && name.endsWith(".js"),
            )!,
          ),
        )
        break
    }

    expect(run(linkCheckout(dir), "argument with spaces")).toEqual({
      code: 7,
      stdout: "current argument with spaces\n",
      stderr: "",
    })
  })
}

test("installed entry selects a current bundle", () => {
  const dir = checkout()

  buildCheckout(dir)
  writeFileSync(join(dir, "dist/bin.js"), 'console.log("bundle")\n')
  expect(run(linkCheckout(dir))).toEqual({ code: 0, stdout: "bundle\n", stderr: "" })
})

beforeAll(() => {
  checkout(packageDir)
  buildCheckout(packageDir)
  mkdirSync(join(scratch, "bin"))
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))

  symlinkSync(join(packageDir, pkg.bin.todo), installed)

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

test("installs the launcher and builds the bundle in prepare", async () => {
  const pkg = await Bun.file(join(root, "package.json")).json()

  expect(pkg.bin.todo).toBe("./bin/todo.ts")
  expect(pkg.scripts["build:cli"]).toBe("bun scripts/build-cli.ts")
  expect(pkg.scripts.prepare).toBe("bun run build:cli")
  expect(readdirSync(outdir)).toContain("bin.js")
  expect(
    readdirSync(outdir).every((name) => name === "freshness.json" || name.endsWith(".js")),
  ).toBe(true)
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
    const measure = (entry: string) => {
      const start = performance.now()
      const result = Bun.spawnSync([entry, "--help"], { cwd: scratch, env })

      expect(result.exitCode, result.stderr.toString()).toBe(0)

      return performance.now() - start
    }

    measure(installed)
    measure(bundled)
    const best = Math.min(...Array.from({ length: 5 }, () => measure(installed)))
    const direct = Math.min(...Array.from({ length: 5 }, () => measure(bundled)))

    console.log(
      `warm help best-of-5: launcher ${best.toFixed(2)} ms, direct ${direct.toFixed(2)} ms, overhead ${(best - direct).toFixed(2)} ms`,
    )
    expect(best).toBeLessThan(80)
  },
)
