import { expect, test } from "bun:test"
import { helpText, parseServerOptions } from "../server.ts"

test("parses server defaults and options", () => {
  const options = parseServerOptions(["--dir", "todo", "--port", "4401", "--host", "0.0.0.0"], {
    cwd: "/tmp",
    username: "tester",
    env: {},
  })
  expect(options).toMatchObject({ cwd: "/tmp", dir: "todo", port: 4401, host: "0.0.0.0" })
  expect(parseServerOptions(["--help"])).toEqual({ help: true })
  expect(helpText).toContain("--dir")
  expect(() => parseServerOptions(["--port", "nope"])).toThrow()
})
