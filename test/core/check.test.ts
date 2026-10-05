import { describe, expect, test } from "bun:test"
import { mergeDiagnostics, modelDiagnostics } from "../../src/core/check.ts"
import { task } from "./fixtures.ts"

const codes = (tasks: Parameters<typeof modelDiagnostics>[0]) =>
  modelDiagnostics(tasks).map((d) => [d.code, d.taskId])

describe("modelDiagnostics", () => {
  test("finds nothing wrong in a consistent list", () => {
    expect(codes([task({ id: "1" }), task({ id: "2", dependsOn: ["1"] })])).toEqual([])
  })

  test("reports duplicate IDs once", () => {
    expect(codes([task({ id: "1" }), task({ id: "1", status: "done" })])).toEqual([
      ["duplicate-id", "1"],
    ])
  })

  test("reports dependencies on unknown IDs", () => {
    expect(codes([task({ id: "1", dependsOn: ["9"] })])).toEqual([["unknown-dependency", "1"]])
  })

  test("reports a self-dependency without also reporting it as a cycle", () => {
    expect(codes([task({ id: "3", dependsOn: ["3"] })])).toEqual([["self-dependency", "3"]])
  })

  test("reports a cycle with the IDs along it", () => {
    const [diagnostic] = modelDiagnostics([
      task({ id: "1", dependsOn: ["2"] }),
      task({ id: "2", dependsOn: ["1"] }),
    ])

    expect(diagnostic).toMatchObject({
      code: "dependency-cycle",
      message: "dependency cycle: 1 → 2 → 1",
      taskId: "1",
    })
  })

  test("a dependency on a cancelled task is a warning, not an error", () => {
    const tasks = [
      task({ id: "1", status: "done", outcome: "cancelled", cancelledReason: "Dropped." }),
      task({ id: "2", dependsOn: ["1"] }),
    ]

    expect(modelDiagnostics(tasks)).toEqual([
      {
        severity: "warning",
        code: "cancelled-dependency",
        message: "task 2 depends on cancelled task 1",
        taskId: "2",
      },
    ])
  })

  test("a dependency on a completed task is not reported", () => {
    const tasks = [
      task({ id: "1", status: "done", outcome: "completed" }),
      task({ id: "2", dependsOn: ["1"] }),
    ]

    expect(modelDiagnostics(tasks)).toEqual([])
  })

  test("treats unresolvable foreign dependency as warning, not error", () => {
    const diagnostics = modelDiagnostics([task({ id: "1", dependsOn: ["slash-usage:1"] })])
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        code: "unresolvable-project",
        message: "task 1 depends on unresolvable project slash-usage",
        taskId: "1",
      },
    ])
  })
})

test("mergeDiagnostics skips model diagnostics the store already reported", () => {
  const store = [
    { severity: "error" as const, code: "duplicate-id", message: "from the store", taskId: "1" },
  ]

  const model = [
    { severity: "error" as const, code: "duplicate-id", message: "from the model", taskId: "1" },
    {
      severity: "error" as const,
      code: "unknown-dependency",
      message: "from the model",
      taskId: "2",
    },
  ]

  expect(mergeDiagnostics(store, model).map((d) => d.message)).toEqual([
    "from the store",
    "from the model",
  ])
})
