import { expect, test } from "bun:test"
import * as core from "../../src/core/index.ts"

test("the public entry point exposes the service, its error and the pure helpers", () => {
  expect(core.TodoService.key).toBe("@lemol/todo-md/core/TodoService")
  for (const name of [
    "HasDependents",
    "viewOf",
    "boardOf",
    "inPriorityOrder",
    "matches",
    "modelDiagnostics",
    "mergeDiagnostics",
  ]) {
    expect(core).toHaveProperty(name)
  }
})
