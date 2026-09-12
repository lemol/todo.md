import { describe, expect, test } from "bun:test"
import { allTasks, boardOf, inPriorityOrder, viewOf } from "../../src/core/views.ts"
import { task } from "./fixtures.ts"

describe("viewOf", () => {
  const done = new Set(["1"])

  test("an open task whose dependencies are all done is ready", () => {
    expect(viewOf(task({ id: "2", dependsOn: ["1"] }), done)).toMatchObject({
      state: "ready",
      blockedBy: [],
    })
  })

  test("an open task with an unfinished or unknown dependency is blocked by it", () => {
    expect(viewOf(task({ id: "3", dependsOn: ["1", "2", "9"] }), done)).toMatchObject({
      state: "blocked",
      blockedBy: ["2", "9"],
    })
  })

  test("a done task is done, whatever its dependencies", () => {
    expect(viewOf(task({ id: "4", status: "done", dependsOn: ["2"] }), done)).toMatchObject({
      state: "done",
      blockedBy: [],
    })
  })
})

describe("boards", () => {
  const list = {
    title: "T",
    description: "",
    ungrouped: [task({ id: "1" })],
    groups: [
      { name: "A", description: "", tasks: [task({ id: "2" }), task({ id: "3" })] },
      { name: "B", description: "", tasks: [task({ id: "4" })] },
    ],
  }

  test("inPriorityOrder lists ungrouped tasks first, then each group in order", () => {
    expect(inPriorityOrder(list).map((t) => t.id)).toEqual(["1", "2", "3", "4"])
  })

  test("a board knows every task and the done IDs", () => {
    const board = boardOf(list, [task({ id: "5", status: "done" })])
    expect(allTasks(board).map((t) => t.id)).toEqual(["1", "2", "3", "4", "5"])
    expect(board.doneIds).toEqual(new Set(["5"]))
  })
})
