import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { Glob } from "bun"

// The module graph from docs/architecture/README.md. Each module may import its own
// files, the modules in `modules`, and the external packages in `packages`.
// An entry ending in ":" allows a whole scheme (e.g. every `node:` builtin).
const rules: Record<string, { modules: string[]; packages: string[] }> = {
  spec: { modules: [], packages: ["effect"] },
  markdown: {
    modules: ["spec"],
    packages: [
      "effect",
      "mdast",
      "mdast-util-from-markdown",
      "mdast-util-frontmatter",
      "mdast-util-gfm-task-list-item",
      "micromark-extension-frontmatter",
      "micromark-extension-gfm-task-list-item",
      "yaml",
    ],
  },
  core: { modules: ["spec"], packages: ["effect"] },
  fs: { modules: ["spec", "markdown"], packages: ["effect"] },
  hub: { modules: ["spec", "core", "fs"], packages: ["effect", "yaml"] },
  git: { modules: ["spec", "fs", "hub"], packages: ["effect"] },
  jira: { modules: ["spec", "hub"], packages: ["effect"] },
  cli: {
    modules: ["spec", "core", "fs", "hub", "git", "jira", "web"],
    packages: ["effect", "@effect/platform-bun", "node:", "bun"],
  },
}

// Test helpers shipped for adapters (`@lemol/todo-md/spec/testing`) and for
// hub users (`@lemol/todo-md/hub/testing`) may use the test runner and
// assertions; nothing else may import them.
const testingEntries = [join("spec", "testing"), join("hub", "testing")]
const testingPackages = ["bun:test", "node:assert"]

const isTestingFile = (path: string) =>
  testingEntries.some(
    (entry) => path === entry || path === `${entry}.ts` || path.startsWith(entry + sep),
  )

const srcRoot = resolve(import.meta.dir, "..", "src")
const webRoot = resolve(srcRoot, "web")

const importPattern =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g

const specifiersOf = (source: string): string[] =>
  [...source.matchAll(importPattern)].map((match) => match[1] ?? match[2] ?? "")

const allows = (entry: string, specifier: string) =>
  specifier === entry ||
  specifier.startsWith(`${entry}/`) ||
  (entry.endsWith(":") && specifier.startsWith(entry))

/** Returns a message for each import in `source` that breaks the rules. `file` is relative to src. */
export const violations = (file: string, source: string): string[] => {
  const module = file.split(sep)[0] ?? ""
  const rule = rules[module]

  if (rule === undefined || !file.includes(sep)) return [`${file}: not inside a known module`]

  return specifiersOf(source).flatMap((specifier) => {
    if (specifier.startsWith(".")) {
      const target = relative(srcRoot, resolve(srcRoot, dirname(file), specifier))
      const targetModule = target.split(sep)[0] ?? ""

      if (target.startsWith("..")) return [`${file}: imports ${specifier}, outside src`]

      if (isTestingFile(target) && !isTestingFile(file)) {
        return [`${file}: runtime code imports test helpers (${specifier})`]
      }

      if (targetModule === module || rule.modules.includes(targetModule)) return []

      return [`${file}: module ${module} must not import module ${targetModule}`]
    }

    if (isTestingFile(file) && testingPackages.some((entry) => allows(entry, specifier))) return []

    if (rule.packages.some((entry) => allows(entry, specifier))) return []

    return [`${file}: module ${module} must not import package ${specifier}`]
  })
}

const webPackages = [
  "effect",
  "@effect/platform-bun",
  "@effect/platform-node-shared",
  "@lemol/ui",
  "remix",
  "mdast-util-from-markdown",
  "mdast-util-to-hast",
  "hast-util-to-html",
]

const webTodoPackages = [
  "@lemol/todo-md/spec",
  "@lemol/todo-md/core",
  "@lemol/todo-md/hub",
  "@lemol/todo-md/markdown",
  "@lemol/todo-md/spec/testing",
  "@lemol/todo-md/hub/testing",
]

const webModules = ["spec", "core", "hub", "git", "jira"]

export const webViolations = (file: string, source: string): string[] => {
  const isTest = file.startsWith("test/") || file.includes(".test.")
  const serverOnly = file === "server.ts" || file === "app/assets.ts"

  return specifiersOf(source).flatMap((specifier) => {
    if (specifier.startsWith(".")) {
      const target = resolve(webRoot, file.includes("/") ? dirname(file) : ".", specifier)

      if (!target.startsWith(webRoot)) {
        const srcRelative = relative(srcRoot, target)
        const targetModule = srcRelative.split(sep)[0] ?? ""

        if (!srcRelative.startsWith("..") && webModules.includes(targetModule)) {
          if (isTestingFile(target) && !isTest) {
            return [`${file}: runtime code imports test helpers (${specifier})`]
          }

          return []
        }

        return [`${file}: imports ${specifier}, outside src/web`]
      }

      return []
    }

    if (specifier === "bun" || specifier.startsWith("node:")) {
      return serverOnly || isTest ? [] : [`${file}: web runtime must not import ${specifier}`]
    }

    if (isTest && (specifier === "bun:test" || specifier === "@lemol/todo-md/spec/testing")) {
      return []
    }

    if (webTodoPackages.includes(specifier)) {
      return [`${file}: web must not import ${specifier}`]
    }

    if (webPackages.some((entry) => allows(entry, specifier))) return []

    return [`${file}: web must not import ${specifier}`]
  })
}

describe("module boundaries", () => {
  test("every source file respects the module graph", () => {
    // src/web is governed by the web import graph below, not the module table.
    const files = [...new Glob("**/*.ts").scanSync({ cwd: srcRoot, onlyFiles: true })].filter(
      (file) => file !== "web" && !file.startsWith(`web${sep}`),
    )

    const found = files.flatMap((file) =>
      violations(file, readFileSync(join(srcRoot, file), "utf8")),
    )

    expect(found).toEqual([])
  })

  test("every web file respects the web import graph", () => {
    const files = [
      ...new Glob("**/*.ts").scanSync({ cwd: webRoot, onlyFiles: true }),
      ...new Glob("**/*.tsx").scanSync({ cwd: webRoot, onlyFiles: true }),
    ]

    const found = files.flatMap((file) =>
      webViolations(file, readFileSync(join(webRoot, file), "utf8")),
    )

    expect(found).toEqual([])
  })

  describe("the checker", () => {
    const at = (...parts: string[]) => join(...parts)

    test("allows own files, permitted modules and packages", () => {
      const source = [
        'import { Task } from "../spec/index.ts"',
        'import type { Root } from "mdast"',
        'export * from "./parse.ts"',
        'import { Effect } from "effect"',
        'import * as Schema from "effect/Schema"',
      ].join("\n")

      expect(violations(at("markdown", "index.ts"), source)).toEqual([])
    })

    test("rejects forbidden modules, packages and escapes", () => {
      const source = [
        'import { FsTodoStore } from "../fs/index.ts"',
        'import { readFile } from "node:fs"',
        'import {\n  a,\n  b\n} from "@lemol/todo-md/spec"',
        'const lazy = import("../../package.json")',
      ].join("\n")

      expect(violations(at("core", "service.ts"), source)).toEqual([
        `${at("core", "service.ts")}: module core must not import module fs`,
        `${at("core", "service.ts")}: module core must not import package node:fs`,
        `${at("core", "service.ts")}: module core must not import package @lemol/todo-md/spec`,
        `${at("core", "service.ts")}: imports ../../package.json, outside src`,
      ])
    })

    test("keeps test helpers out of runtime code", () => {
      expect(violations(at("spec", "testing.ts"), 'import { test } from "bun:test"')).toEqual([])
      expect(
        violations(at("spec", "testing", "assert.ts"), 'import { ok } from "node:assert/strict"'),
      ).toEqual([])
      expect(violations(at("spec", "store.ts"), 'import { test } from "bun:test"')).toHaveLength(1)
      expect(
        violations(at("core", "service.ts"), 'import { effectTest } from "../spec/testing.ts"'),
      ).toEqual([
        `${at("core", "service.ts")}: runtime code imports test helpers (../spec/testing.ts)`,
      ])
    })

    test("lets hub use core, fs and yaml, and nothing above it", () => {
      const source = [
        'import { TodoService } from "../core/index.ts"',
        'import { FsTodoStore } from "../fs/index.ts"',
        'import { parseDocument } from "yaml"',
      ].join("\n")

      expect(violations(at("hub", "Hub.ts"), source)).toEqual([])
      expect(violations(at("hub", "Hub.ts"), 'import { x } from "../cli/errors.ts"')).toEqual([
        `${at("hub", "Hub.ts")}: module hub must not import module cli`,
      ])
      expect(violations(at("hub", "Hub.ts"), 'import { homedir } from "node:os"')).toEqual([
        `${at("hub", "Hub.ts")}: module hub must not import package node:os`,
      ])
      expect(violations(at("cli", "context.ts"), 'import { Hub } from "../hub/index.ts"')).toEqual(
        [],
      )
    })

    test("lets git use spec, fs and hub, and nothing above it", () => {
      const source = [
        'import { FsTodoStore } from "../fs/index.ts"',
        'import { watchList } from "../hub/index.ts"',
        'import { TodoStore } from "../spec/index.ts"',
        'import { ChildProcess } from "effect/process"',
      ].join("\n")

      expect(violations(at("git", "GitSource.ts"), source)).toEqual([])
      expect(
        violations(at("git", "GitSource.ts"), 'import { TodoService } from "../core/index.ts"'),
      ).toEqual([`${at("git", "GitSource.ts")}: module git must not import module core`])
      expect(violations(at("git", "git.ts"), 'import { spawn } from "node:child_process"')).toEqual(
        [`${at("git", "git.ts")}: module git must not import package node:child_process`],
      )
      expect(
        violations(at("cli", "bin.ts"), 'import { GitSource } from "../git/index.ts"'),
      ).toEqual([])
      expect(
        violations(at("hub", "Hub.ts"), 'import { GitSource } from "../git/index.ts"'),
      ).toEqual([`${at("hub", "Hub.ts")}: module hub must not import module git`])
    })

    test("lets jira use spec and hub, and neither fs nor git", () => {
      const source = [
        'import { watchList } from "../hub/index.ts"',
        'import { TodoStore } from "../spec/index.ts"',
        'import { HttpClient } from "effect/http"',
        'import { ChildProcessSpawner } from "effect/process"',
      ].join("\n")

      expect(violations(at("jira", "JiraSource.ts"), source)).toEqual([])
      expect(
        violations(at("jira", "store.ts"), 'import { makeLock } from "../fs/index.ts"'),
      ).toEqual([`${at("jira", "store.ts")}: module jira must not import module fs`])
      expect(
        violations(at("jira", "client.ts"), 'import { makeGit } from "../git/git.ts"'),
      ).toEqual([`${at("jira", "client.ts")}: module jira must not import module git`])
      expect(violations(at("jira", "client.ts"), 'import { request } from "node:https"')).toEqual([
        `${at("jira", "client.ts")}: module jira must not import package node:https`,
      ])
      expect(
        violations(at("cli", "bin.ts"), 'import { JiraSource } from "../jira/index.ts"'),
      ).toEqual([])
      expect(
        violations(at("hub", "Hub.ts"), 'import { JiraSource } from "../jira/index.ts"'),
      ).toEqual([`${at("hub", "Hub.ts")}: module hub must not import module jira`])
    })

    test("keeps hub test helpers out of runtime code", () => {
      expect(
        violations(at("hub", "testing.ts"), 'import { MemoryTodoStore } from "../spec/index.ts"'),
      ).toEqual([])
      expect(
        violations(at("hub", "Hub.ts"), 'import { memorySource } from "./testing.ts"'),
      ).toEqual([`${at("hub", "Hub.ts")}: runtime code imports test helpers (./testing.ts)`])
      expect(
        violations(at("cli", "main.ts"), 'import { memorySource } from "../hub/testing.ts"'),
      ).toEqual([`${at("cli", "main.ts")}: runtime code imports test helpers (../hub/testing.ts)`])
    })

    test("rejects files outside a module", () => {
      expect(violations("index.ts", "")).toEqual(["index.ts: not inside a known module"])
    })

    test("web reaches sibling modules through relative paths", () => {
      expect(
        webViolations("app/router.ts", 'import { TodoService } from "../../core/index.ts"'),
      ).toEqual([])
      expect(
        webViolations("app/router.ts", 'import { parseTodoFile } from "../../markdown/index.ts"'),
      ).toEqual(["app/router.ts: imports ../../markdown/index.ts, outside src/web"])
      expect(webViolations("app/router.ts", 'import { x } from "@lemol/todo-md/core"')).toEqual([
        "app/router.ts: web must not import @lemol/todo-md/core",
      ])
      expect(
        webViolations("app/router.ts", 'const lazy = import("../../../package.json")'),
      ).toEqual(["app/router.ts: imports ../../../package.json, outside src/web"])
    })

    test("web test helpers cannot leak into runtime", () => {
      expect(
        webViolations("app/router.ts", 'import { effectTest } from "@lemol/todo-md/spec/testing"'),
      ).toHaveLength(1)
      expect(
        webViolations(
          "test/router.test.ts",
          'import { effectTest } from "@lemol/todo-md/spec/testing"',
        ),
      ).toEqual([])
    })
  })
})
