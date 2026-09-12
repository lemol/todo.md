import { describe, expect, test } from "bun:test"
import { formatId, isId, nextId, parseId } from "../../src/markdown/ids.ts"

describe("IDs", () => {
  test("parseId strips leading zeros and rejects non-digits", () => {
    expect(parseId("07")).toBe("7")
    expect(parseId("0")).toBe("0")
    expect(parseId("105")).toBe("105")
    expect(parseId("7a")).toBeUndefined()
    expect(parseId("")).toBeUndefined()
  })

  test("formatId pads to at least two digits", () => {
    expect(formatId("7")).toBe("07")
    expect(formatId("12")).toBe("12")
    expect(formatId("105")).toBe("105")
  })

  test("nextId is one more than the largest ID", () => {
    expect(nextId([])).toBe("1")
    expect(nextId(["3", "12", "7"])).toBe("13")
    expect(nextId(["99999999999999999999"])).toBe("100000000000000000000")
  })

  test("isId accepts only digits", () => {
    expect(isId("07")).toBe(true)
    expect(isId("PROJ-1")).toBe(false)
  })
})
