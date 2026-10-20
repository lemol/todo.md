/**
 * Test isolation, preloaded before every suite (see `bunfig.toml`).
 *
 * This repository is itself a todo.md list, and the machine running the tests
 * has a hub registry that names it. A test that reaches either one edits real
 * work, and does it silently: the suite still passes. So there are two
 * defences. Every process started from here gets an empty hub of its own, and
 * the real list and registry are watched, so an escape fails the test that
 * made it instead of going unnoticed.
 */

import { afterEach } from "bun:test"
import { type Dirent, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

const repo = resolve(import.meta.dir, "..")

const realHome = process.env.TODO_MD_HOME ?? join(homedir(), ".todo-md")

/** Where an escape lands: this repository's own backlog, and the machine's hub. */
const guarded = [join(repo, "todo"), realHome]

// The hub's parse cache is derived, and every `todo` process on the machine
// writes it, so a change there is no escape: it failed whichever test was
// running. It also grows with every list parsed, and hashing it after each
// test made the suite crawl.
const unguarded = new Set([join(realHome, "cache")])

// Read before it is replaced, so the guard above watches the real home even
// though nothing under test can now find it. Spawned processes inherit this.
const home = mkdtempSync(join(tmpdir(), "todo-md-test-home-"))

process.env.TODO_MD_HOME = home
process.on("exit", () => rmSync(home, { recursive: true, force: true }))

/** Every file below `dir` as sorted `<path> <hash>` lines; a missing `dir` is empty. */
const snapshotOf = (dir: string): string => {
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

      if (unguarded.has(full)) continue

      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        let text: string

        // Another process may remove it between the listing and the read.
        try {
          text = readFileSync(full, "utf8")
        } catch {
          continue
        }

        lines.push(`${relative(dir, full)} ${Bun.hash(text).toString(16)}`)
      }
    }
  }

  walk(dir)

  return lines.sort().join("\n")
}

/** What changed between two snapshots: `+` added, `-` removed, `~` rewritten. */
const changesBetween = (before: string, after: string): string => {
  const parse = (snapshot: string) =>
    new Map(
      snapshot === ""
        ? []
        : snapshot.split("\n").map((line) => {
            const space = line.lastIndexOf(" ")

            return [line.slice(0, space), line.slice(space + 1)] as const
          }),
    )

  const from = parse(before)
  const to = parse(after)
  const lines: string[] = []

  for (const [path, hash] of to) {
    const was = from.get(path)

    if (was === undefined) lines.push(`  + ${path}`)
    else if (was !== hash) lines.push(`  ~ ${path}`)
  }

  for (const path of from.keys()) if (!to.has(path)) lines.push(`  - ${path}`)

  return lines.sort().join("\n")
}

const baselines = new Map(guarded.map((dir) => [dir, snapshotOf(dir)] as const))

// The escaped writes stay on disk, so the new state becomes the baseline: the
// rest of the run reports its own escapes instead of this one over and over.
afterEach(() => {
  for (const [dir, before] of baselines) {
    const after = snapshotOf(dir)

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
