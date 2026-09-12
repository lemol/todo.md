import { expect, test } from "bun:test"
import packageJson from "../../package.json"
import * as cli from "../../src/cli/index.ts"

test("the entry point exposes main, the command tree and the version", () => {
  expect(typeof cli.main).toBe("function")
  expect(cli.todo.name).toBe("todo")
  expect(cli.CliContext.key).toBe("@lemol/todo-md/cli/CliContext")
})

test("the CLI's version is package.json's version", () => {
  expect(cli.version).toBe(packageJson.version)
})
