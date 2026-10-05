import { Schema } from "effect"

export { NoListFound } from "../hub/index.ts"

/** The command line asked for nothing to do, or for contradictory things. */
export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", {
  message: Schema.String,
}) {}

/** `todo check` found errors; they were already printed. */
export class ProblemsFound extends Schema.TaggedError<ProblemsFound>()("ProblemsFound", {
  errors: Schema.Number,
}) {}

/** `todo sync` finished with failures; the per-project lines were already printed. */
export class SyncFailed extends Schema.TaggedError<SyncFailed>()("SyncFailed", {
  errors: Schema.Number,
}) {}

type Tagged = { readonly _tag: string } & Record<string, unknown>

const isTagged = (error: unknown): error is Tagged =>
  typeof error === "object" &&
  error !== null &&
  typeof (error as { _tag?: unknown })._tag === "string"

const pastTense: Record<string, string> = {
  move: "moved",
  complete: "completed",
  reopen: "reopened",
}

/** A one-line, human explanation of a failure. */
export const describeError = (error: unknown): string => {
  if (!isTagged(error)) return String(error)

  const text = (key: string) => String(error[key] ?? "")
  const list = (key: string) => {
    const value = error[key]

    return Array.isArray(value) ? value.join(", ") : ""
  }

  switch (error._tag) {
    case "TaskNotFound":
      return `no task ${text("id")}`
    case "GroupNotFound":
      return `no group "${text("name")}"`
    case "InvalidTransition": {
      const operation = text("operation")

      return `task ${text("id")} is ${text("status")}, so it cannot be ${pastTense[operation] ?? operation}`
    }
    case "ValidationError":
      return `invalid input: ${list("issues")}`
    case "Unsupported":
      return `this list does not support ${text("operation")}`
    case "HasDependents":
      return `task ${text("id")} is needed by ${list("dependents")}; use --force to remove it anyway`
    case "NoListFound":
      return `no todo.md list found from ${text("cwd")}; run \`todo init\` or pass --dir`
    case "ProblemsFound":
      return `check found ${text("errors")} error(s)`
    case "SyncFailed": {
      const errors = Number(error.errors)

      return `sync failed for ${errors} project${errors === 1 ? "" : "s"}`
    }
    default:
      return typeof error.message === "string" && error.message !== "" ? error.message : error._tag
  }
}

const isPlain = (value: unknown) =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  Array.isArray(value)

/** The JSON form of a failure: its tag, the message, and its plain fields. */
export const errorJson = (error: unknown): Record<string, unknown> => {
  if (!isTagged(error)) return { tag: "Error", message: String(error) }

  const fields = Object.entries(error).filter(
    ([key, value]) => key !== "_tag" && key !== "message" && isPlain(value),
  )

  return { tag: error._tag, message: describeError(error), ...Object.fromEntries(fields) }
}

/** Exit codes: 0 success, 1 a failed operation or problems found, 2 a usage error. */
export const exitCodeOf = (error: unknown): 1 | 2 =>
  isTagged(error) && (error._tag === "ShowHelp" || error._tag === "UsageError") ? 2 : 1
