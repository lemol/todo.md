import { expect, test } from "bun:test"
import { markDirtyOnInput, refreshDecision } from "./refresh.ts"

test("chooses reload for clean pages and notice for dirty pages", () => {
  expect(refreshDecision(false)).toBe("reload")
  expect(refreshDecision(true)).toBe("notice")
  expect(markDirtyOnInput(new Event("input"))).toBe(true)
  expect(markDirtyOnInput(new Event("change"))).toBe(true)
  expect(markDirtyOnInput(new Event("click"))).toBe(false)
})
