import { expect, test, spyOn } from "bun:test"
import * as fs from "node:fs"
import { join } from "node:path"
import { changesBetween, guarded, realHome, repo, scratchDirectory, snapshotOf } from "./sandbox.ts"

const temporaryDirectory = () => fs.realpathSync(scratchDirectory("sandbox-test-"))

test("reports added, removed and rewritten files, including paths with spaces and cache", () => {
  const dir = temporaryDirectory()

  try {
    fs.mkdirSync(join(dir, "cache"))
    fs.writeFileSync(join(dir, "removed"), "old")
    fs.writeFileSync(join(dir, "cache", "with spaces"), "old")
    const before = snapshotOf(dir)

    fs.unlinkSync(join(dir, "removed"))
    fs.writeFileSync(join(dir, "added"), "new")
    fs.writeFileSync(join(dir, "cache", "with spaces"), "new contents")
    expect(changesBetween(before, snapshotOf(dir))).toBe(
      "  + added\n  - removed\n  ~ cache/with spaces",
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("skipped directories are not reported, the files beside them still are", () => {
  const dir = temporaryDirectory()

  try {
    fs.mkdirSync(join(dir, "cache"))
    fs.writeFileSync(join(dir, "cache", "list.json"), "old")
    fs.writeFileSync(join(dir, "registry.json"), "old")
    const before = snapshotOf(dir, ["cache"])

    fs.writeFileSync(join(dir, "cache", "list.json"), "new contents")
    fs.writeFileSync(join(dir, "cache", "added.json"), "new")
    expect(changesBetween(before, snapshotOf(dir, ["cache"]))).toBe("")

    fs.writeFileSync(join(dir, "registry.json"), "new contents")
    expect(changesBetween(before, snapshotOf(dir, ["cache"]))).toBe("  ~ registry.json")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("the real hub's cache is skipped and its registry is not", () => {
  expect(guarded.find((entry) => entry.dir === realHome)?.skip).toEqual(["cache"])
  expect(guarded.find((entry) => entry.dir === join(repo, "todo"))?.skip).toEqual([])
})

test("the preload attributes an escape to the test that writes it", () => {
  const dir = temporaryDirectory()

  try {
    fs.mkdirSync(join(dir, "test"))
    fs.mkdirSync(join(dir, "todo"))
    fs.copyFileSync(join(import.meta.dir, "sandbox.ts"), join(dir, "test", "sandbox.ts"))
    fs.writeFileSync(
      join(dir, "escape.test.ts"),
      'import { test } from "bun:test"; import { writeFileSync } from "node:fs"; test("escape", () => writeFileSync("todo/escaped", "oops"))',
    )
    const result = Bun.spawnSync(
      [process.execPath, "test", "--preload", "./test/sandbox.ts", "escape.test.ts"],
      {
        cwd: dir,
        env: { ...process.env, HOME: dir, TODO_MD_HOME: join(dir, "hub") },
      },
    )

    const output = result.stdout.toString() + result.stderr.toString()

    expect(result.exitCode).not.toBe(0)
    expect(output).toContain(
      `this test wrote outside its temporary directory, into ${join(dir, "todo")}:`,
    )
    expect(output).toContain("  + escaped")
    expect(output).toContain("escape")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("snapshots file metadata without reading contents", () => {
  const dir = temporaryDirectory()

  try {
    const file = join(dir, "file")

    fs.writeFileSync(file, "contents")
    const stat = fs.statSync(file)
    const read = spyOn(fs, "readFileSync")

    try {
      const snapshot = snapshotOf(dir)

      expect(read).not.toHaveBeenCalled()
      expect(snapshot).toBe(`file ${stat.size} ${stat.mtimeMs} ${stat.ino}`)
    } finally {
      read.mockRestore()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("a run removes the temporary directories it made, and no others", () => {
  const dir = temporaryDirectory()

  try {
    const tmp = join(dir, "tmp")

    // Another run's, on the same machine at the same time: they must outlive this one.
    fs.mkdirSync(tmp)
    fs.mkdirSync(join(tmp, "todo-md-test-home-elsewhere"))
    fs.mkdirSync(join(tmp, "todo-md-git-templates-elsewhere"))
    fs.writeFileSync(
      join(dir, "fixture.test.ts"),
      [
        'import { expect, test } from "bun:test"',
        'import { rmSync } from "node:fs"',
        `import { scratchDirectory } from ${JSON.stringify(join(import.meta.dir, "sandbox.ts"))}`,
        'import { join } from "node:path"',
        `import { remoteIn } from ${JSON.stringify(join(import.meta.dir, "git", "helpers.ts"))}`,
        'test("seeds a git remote, as the git tier does", () => {',
        '  const root = scratchDirectory("fixture-")',
        "  try {",
        '    expect(remoteIn(root, { "TODO.md": "# Fixture\\n" })).toBe(join(root, "remote.git"))',
        "  } finally {",
        "    rmSync(root, { recursive: true, force: true })",
        "  }",
        "})",
      ].join("\n"),
    )
    const result = Bun.spawnSync(
      [
        process.execPath,
        "test",
        "--preload",
        join(import.meta.dir, "sandbox.ts"),
        "./fixture.test.ts",
      ],
      { cwd: dir, env: { ...process.env, HOME: dir, TMPDIR: tmp } },
    )

    expect(result.stderr.toString()).toContain(" 1 pass")
    expect(result.exitCode).toBe(0)
    expect(
      fs
        .readdirSync(tmp)
        .filter((name) => name.startsWith("todo-md-"))
        .sort(),
    ).toEqual(["todo-md-git-templates-elsewhere", "todo-md-test-home-elsewhere"])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
