import { expect, test } from "bun:test"
import * as spec from "../../src/spec/index.ts"

test("the public entry point exposes the model, contract, reference store and helpers", () => {
  expect(spec.TodoStore.key).toBe("@lemol/todo-md/spec/TodoStore")
  expect(spec.allCapabilities).toEqual({
    groups: true,
    reorder: true,
    renameGroup: true,
    comments: true,
    promote: true,
    cancel: true,
    add: true,
    remove: true,
    edit: true,
    commentAuthor: true,
  })
  expect(typeof spec.MemoryTodoStore.layer).toBe("function")
  for (const name of ["Task", "TaskInput", "TaskNotFound", "Diagnostic", "findCycle", "validate"]) {
    expect(spec).toHaveProperty(name)
  }
})
