import { Schema } from "effect"
import { TaskStatus } from "./model.ts"

/** No open or done task has this ID. */
export class TaskNotFound extends Schema.TaggedError<TaskNotFound>()("TaskNotFound", {
  id: Schema.String,
}) {}

/** No open group has this name. */
export class GroupNotFound extends Schema.TaggedError<GroupNotFound>()("GroupNotFound", {
  name: Schema.String,
}) {}

/** The operation does not apply to a task in this status, e.g. completing a done task. */
export class InvalidTransition extends Schema.TaggedError<InvalidTransition>()(
  "InvalidTransition",
  { id: Schema.String, status: TaskStatus, operation: Schema.String },
) {}

/** The input, or the list the operation would produce, violates the model. */
export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  issues: Schema.Array(Schema.String),
}) {}

/** The store lacks the capability the operation needs (spec §1.5). */
export class Unsupported extends Schema.TaggedError<Unsupported>()("Unsupported", {
  operation: Schema.String,
}) {}

/** An I/O, network or backend failure. */
export class StoreError extends Schema.TaggedError<StoreError>()("StoreError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
