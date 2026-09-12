import { Schema } from "effect"
import { TaskId } from "./model.ts"

export const Severity = Schema.Literals(["error", "warning", "info"])
export type Severity = typeof Severity.Type

/** A non-fatal issue found while reading a list (spec §1.6, §2.12). */
export const Diagnostic = Schema.Struct({
  severity: Severity,
  /** Stable kebab-case code from the spec, e.g. `broken-link`. */
  code: Schema.String,
  message: Schema.String,
  taskId: Schema.optional(TaskId),
  /** Path relative to the list root, when the issue has a location. */
  file: Schema.optional(Schema.String),
  /** 1-based line in `file`. */
  line: Schema.optional(Schema.Int),
})
export type Diagnostic = typeof Diagnostic.Type
