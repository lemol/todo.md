import { Schema } from "effect"

const singleLine = Schema.isPattern(/^[^\r\n]*$/, { expected: "a single line" })
const noWhitespace = Schema.isPattern(/^\S+$/, { expected: "a value without whitespace" })

/** Opaque task identifier (spec §1.2). The file-system format uses decimal integers ("7"). */
export const TaskId = Schema.NonEmptyString
export type TaskId = typeof TaskId.Type

/** Non-empty, single-line text without surrounding whitespace: titles, names, tags. */
export const Label = Schema.Trimmed.check(Schema.isNonEmpty(), singleLine)
export type Label = typeof Label.Type

/** A person or agent handle: non-empty, no whitespace (spec §1.1, Comment.author). */
export const Handle = Schema.String.check(noWhitespace)
export type Handle = typeof Handle.Type

export const TaskStatus = Schema.Literals(["open", "done"])
export type TaskStatus = typeof TaskStatus.Type

export const Extra = Schema.Record(Schema.String, Schema.Unknown)
export type Extra = typeof Extra.Type

export const Comment = Schema.Struct({
  author: Handle,
  at: Schema.DateTimeUtc,
  body: Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty()),
})
export type Comment = typeof Comment.Type

export const Task = Schema.Struct({
  id: TaskId,
  title: Label,
  description: Schema.String,
  status: TaskStatus,
  tags: Schema.Array(Label),
  assignee: Schema.optional(Label),
  dependsOn: Schema.Array(TaskId),
  comments: Schema.Array(Comment),
  group: Schema.optional(Label),
  completedAt: Schema.optional(Schema.DateTimeUtc),
  extra: Extra,
})
export type Task = typeof Task.Type

export const Group = Schema.Struct({
  name: Label,
  description: Schema.String,
  tasks: Schema.Array(Task),
})
export type Group = typeof Group.Type

export const TodoList = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  ungrouped: Schema.Array(Task),
  groups: Schema.Array(Group),
})
export type TodoList = typeof TodoList.Type

/** Input for `add` (spec §1.4). */
export const TaskInput = Schema.Struct({
  title: Label,
  description: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Label)),
  assignee: Schema.optional(Label),
  dependsOn: Schema.optional(Schema.Array(TaskId)),
  extra: Schema.optional(Extra),
})
export type TaskInput = typeof TaskInput.Type

/** Changes for `update` (spec §1.4). Absent fields are unchanged; `assignee: null` clears it. */
export const TaskPatch = Schema.Struct({
  title: Schema.optional(Label),
  description: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Label)),
  assignee: Schema.optional(Schema.NullOr(Label)),
  dependsOn: Schema.optional(Schema.Array(TaskId)),
  extra: Schema.optional(Extra),
})
export type TaskPatch = typeof TaskPatch.Type

/** Where a task goes (spec §1.4). No group means ungrouped; an anchor decides the group. */
export const Placement = Schema.Struct({
  group: Schema.optional(Label),
  before: Schema.optional(TaskId),
  after: Schema.optional(TaskId),
})
export type Placement = typeof Placement.Type

export const CommentInput = Schema.Struct({
  author: Handle,
  body: Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty()),
})
export type CommentInput = typeof CommentInput.Type
