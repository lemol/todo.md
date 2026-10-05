import { expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { diskWith } from "../fs/helpers.ts"
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
