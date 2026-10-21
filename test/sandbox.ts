/**
 * Test isolation, preloaded before every suite (see `bunfig.toml`).
 *
 * This repository is itself a todo.md list, and the machine running the tests
 * has a hub registry that names it. A test that reaches either one edits real
 * work, and does it silently: the suite still passes. So there are two
 * defences. Every process started from here gets an empty hub of its own, and
 * the real list and registry are watched, so an escape fails the test that
 * made it instead of going unnoticed.
 *
 * The hub's `cache/` directory is not watched. It holds the parse cache, which
 * is never a source of truth (spec, storage architecture), and every real
 * `todo` or nzila process on the machine rewrites it, so a change there edits
 * no one's work and would fail whichever test happened to be running. The
 * registry and the rest of the home, and this repository's `todo/`, stay
 * watched.
 */

import { afterEach } from "bun:test"
import { type Dirent, mkdtempSync, readdirSync, statSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

export const repo = resolve(import.meta.dir, "..")

export const realHome = process.env.TODO_MD_HOME ?? join(homedir(), ".todo-md")

/** Where an escape lands: this repository's own backlog, and the machine's hub.
 * `skip` names top-level directories left out of the watch. */
export const guarded: ReadonlyArray<{ dir: string; skip: ReadonlyArray<string> }> = [
  { dir: join(repo, "todo"), skip: [] },
  { dir: realHome, skip: ["cache"] },
]

// Read before it is replaced, so the guard above watches the real home even
// though nothing under test can now find it. Spawned processes inherit this.
const home = mkdtempSync(join(tmpdir(), "todo-md-test-home-"))

process.env.TODO_MD_HOME = home
process.on("exit", () => rmSync(home, { recursive: true, force: true }))

/** Sorted `<path> <size> <mtimeMs> <ino>` lines, without reading file contents.
 * A missing directory is empty; rewrites preserving all metadata go unnoticed.
 * Top-level directories named in `skip` are left out.
 */
export const snapshotOf = (dir: string, skip: ReadonlyArray<string> = []): string => {
  const lines: string[] = []

  const walk = (at: string) => {
    let entries: ReadonlyArray<Dirent<string>>

    try {
      entries = readdirSync(at, { withFileTypes: true, encoding: "utf8" })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = join(at, entry.name)

      if (entry.isDirectory()) {
        if (at !== dir || !skip.includes(entry.name)) walk(full)
      } else if (entry.isFile()) {
        // Another process may remove it between the listing and the stat.
        try {
          const stat = statSync(full)

          lines.push(`${relative(dir, full)} ${stat.size} ${stat.mtimeMs} ${stat.ino}`)
        } catch {
          continue
        }
      }
    }
  }

  walk(dir)

  return lines.sort().join("\n")
}

/** What changed between two snapshots: `+` added, `-` removed, `~` metadata changed. */
export const changesBetween = (before: string, after: string): string => {
  const parse = (snapshot: string) =>
    new Map(
      snapshot === ""
        ? []
        : snapshot.split("\n").map((line) => {
            const space = line.lastIndexOf(
              " ",
              line.lastIndexOf(" ", line.lastIndexOf(" ") - 1) - 1,
            )

            return [line.slice(0, space), line.slice(space + 1)] as const
          }),
    )

  const from = parse(before)
  const to = parse(after)
  const lines: string[] = []

  for (const [path, metadata] of to) {
    const was = from.get(path)

    if (was === undefined) lines.push(`  + ${path}`)
    else if (was !== metadata) lines.push(`  ~ ${path}`)
  }

  for (const path of from.keys()) if (!to.has(path)) lines.push(`  - ${path}`)

  return lines.sort().join("\n")
}

const baselines = new Map(guarded.map(({ dir, skip }) => [dir, snapshotOf(dir, skip)] as const))
const skips = new Map(guarded.map(({ dir, skip }) => [dir, skip] as const))

// The escaped writes stay on disk, so the new state becomes the baseline: the
// rest of the run reports its own escapes instead of this one over and over.
afterEach(() => {
  for (const [dir, before] of baselines) {
    const after = snapshotOf(dir, skips.get(dir))

    if (after === before) continue

    baselines.set(dir, after)
    throw new Error(
      [
        `this test wrote outside its temporary directory, into ${dir}:`,
        changesBetween(before, after),
        "Give the code under test a home and a working directory of its own.",
      ].join("\n"),
    )
  }
})
