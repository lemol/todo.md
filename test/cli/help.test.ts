import { expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { diskWith } from "../fs/helpers.ts"
import { todo } from "./harness.ts"

/** The lines of a help section: after its heading, up to a blank line or the next heading. */
const section = (help: string, heading: string): string[] => {
  const lines = help.split("\n")
  const start = lines.indexOf(heading)

  if (start === -1) return []

  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line === "" || /^[A-Z][A-Z ]+$/.test(line))

  return end === -1 ? rest : rest.slice(0, end)
}

/** A flag or argument line with a description: the name, two or more spaces, then text. */
const described = /^ {2}\S.*?\S {2,}\S/

effectTest(
  "every command has --help with a description, examples and a description for each flag",
  Effect.gen(function* () {
    const root = yield* todo("--help")

    expect(root.code).toBe(0)
    expect(section(root.stdout, "EXAMPLES").length).toBeGreaterThan(0)
    const commands = section(root.stdout, "SUBCOMMANDS").map(
      (line) => line.trim().split(/[\s,]+/)[0] ?? "",
    )

    expect(commands).toEqual([
      "list",
      "next",
      "show",
      "add",
      "edit",
      "done",
      "reopen",
      "cancel",
      "mv",
      "rm",
      "promote",
      "comment",
      "check",
      "init",
      "fmt",
      "projects",
      "sync",
      "jira",
      "web",
    ])

    for (const command of commands) {
      const help = yield* todo(command, "--help")

      expect(help.code, command).toBe(0)
      expect(section(help.stdout, "DESCRIPTION").length, command).toBeGreaterThan(0)
      expect(section(help.stdout, "EXAMPLES").length, command).toBeGreaterThan(0)

      for (const line of [...section(help.stdout, "FLAGS"), ...section(help.stdout, "ARGUMENTS")]) {
        expect(line, `${command}: ${line}`).toMatch(described)
      }
    }

    const subcommands = [
      ...["ls", "add", "rm", "rename"].map((sub) => ["projects", sub]),
      ["jira", "pull"],
    ]

    for (const [parent = "", sub = ""] of subcommands) {
      const name = `${parent} ${sub}`
      const help = yield* todo(parent, sub, "--help")

      expect(help.code, name).toBe(0)
      expect(section(help.stdout, "DESCRIPTION").length, name).toBeGreaterThan(0)
      expect(section(help.stdout, "EXAMPLES").length, name).toBeGreaterThan(0)

      for (const line of [...section(help.stdout, "FLAGS"), ...section(help.stdout, "ARGUMENTS")]) {
        expect(line, `${name}: ${line}`).toMatch(described)
      }
    }
  }),
  diskWith({}),
)

effectTest(
  "-h is --help, and help works without a list",
  Effect.gen(function* () {
    const help = yield* todo("add", "-h")

    expect(help.code).toBe(0)
    expect(help.stdout).toContain("todo add [flags] <title...>")
  }),
  diskWith({}),
)
