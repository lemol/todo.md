import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { ValidationError } from "../../src/spec/errors.ts"
import { Label, type Task } from "../../src/spec/model.ts"
import { ensureAcyclic, unique, validate } from "../../src/spec/validation.ts"

const task = (id: string, dependsOn: string[]): Task => ({
  id,
  title: `Task ${id}`,
  description: "",
  status: "open",
  tags: [],
  dependsOn,
  comments: [],
  extra: {},
})

describe("validate", () => {
  test("returns the decoded value", async () => {
    expect(await Effect.runPromise(validate(Label, "Ship it"))).toBe("Ship it")
  })

  test("fails with ValidationError", async () => {
    const error = await Effect.runPromise(Effect.flip(validate(Label, "")))
    expect(error).toBeInstanceOf(ValidationError)
    expect(error.issues).toHaveLength(1)
  })
})

describe("ensureAcyclic", () => {
  test("succeeds without cycles", () => {
    expect(
      Exit.isSuccess(Effect.runSyncExit(ensureAcyclic([task("1", []), task("2", ["1"])]))),
    ).toBe(true)
  })

  test("fails with the cycle in the message", async () => {
    const error = await Effect.runPromise(
      Effect.flip(ensureAcyclic([task("1", ["2"]), task("2", ["1"])])),
    )

    expect(error.issues).toEqual(["dependency cycle: 1 → 2 → 1"])
  })
})

describe("unique", () => {
  test("keeps the first occurrence of each value", () => {
    expect(unique(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"])
  })
})
