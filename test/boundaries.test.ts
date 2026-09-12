import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { Glob } from "bun"

// The module graph from docs/architecture.md. Each module may import its own
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
  cli: {
    modules: ["spec", "core", "fs"],
    packages: ["effect", "@effect/platform-bun", "node:", "bun"],
  },
}

// Test helpers shipped for adapters (`@lemol/todo-md/spec/testing`) may use
// the test runner; nothing else may import them.
const testingEntry = join("spec", "testing")
const isTestingFile = (path: string) =>
  path === testingEntry || path === `${testingEntry}.ts` || path.startsWith(testingEntry + sep)

const srcRoot = resolve(import.meta.dir, "..", "src")

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
    if (specifier === "bun:test" && isTestingFile(file)) return []
    if (rule.packages.some((entry) => allows(entry, specifier))) return []
    return [`${file}: module ${module} must not import package ${specifier}`]
  })
}

describe("module boundaries", () => {
  test("every source file respects the module graph", () => {
    const files = [...new Glob("**/*.ts").scanSync({ cwd: srcRoot, onlyFiles: true })]
    const found = files.flatMap((file) =>
      violations(file, readFileSync(join(srcRoot, file), "utf8")),
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
      expect(violations(at("spec", "store.ts"), 'import { test } from "bun:test"')).toHaveLength(1)
      expect(
        violations(at("core", "service.ts"), 'import { effectTest } from "../spec/testing.ts"'),
      ).toEqual([
        `${at("core", "service.ts")}: runtime code imports test helpers (../spec/testing.ts)`,
      ])
    })

    test("rejects files outside a module", () => {
      expect(violations("index.ts", "")).toEqual(["index.ts: not inside a known module"])
    })
  })
})
