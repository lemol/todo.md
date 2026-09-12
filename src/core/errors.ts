import { Schema } from "effect"

/** `remove` refused: open tasks still depend on the task. Pass `force` to remove it anyway. */
export class HasDependents extends Schema.TaggedError<HasDependents>()("HasDependents", {
  id: Schema.String,
  dependents: Schema.Array(Schema.String),
}) {}
