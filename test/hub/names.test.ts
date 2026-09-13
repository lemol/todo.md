import { describe, expect, test } from "bun:test"
import { isValidName, nameForList, nameFrom, uniqueName } from "../../src/hub/names.ts"

describe("project names", () => {
  test.each([
    ["todo-md", true],
    ["a1", true],
    ["7", true],
    ["-a", false],
    ["My-App", false],
    ["a_b", false],
    ["a:b", false],
    ["", false],
  ])("%s valid: %p", (name, valid) => {
    expect(isValidName(name)).toBe(valid)
  })

  test("nameFrom slugs free text", () => {
    expect(nameFrom("My Tool")).toBe("my-tool")
    expect(nameFrom("__app__")).toBe("app")
    expect(nameFrom("!!!")).toBeUndefined()
  })

  test("uniqueName adds the first free numeric suffix", () => {
    expect(uniqueName("app", new Set())).toBe("app")
    expect(uniqueName("app", new Set(["app", "app-2"]))).toBe("app-3")
  })

  test("nameForList uses the project directory, the parent of a todo/ list", () => {
    expect(nameForList("/code/app/todo")).toBe("app")
    expect(nameForList("/code/app/todo/")).toBe("app")
    expect(nameForList("/code/My App")).toBe("my-app")
    expect(nameForList("/")).toBeUndefined()
  })
})
