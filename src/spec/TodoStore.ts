import { Context, type Effect, Schema } from "effect"
import type { Diagnostic } from "./diagnostic.ts"
import type {
  GroupNotFound,
  InvalidTransition,
  StoreError,
  TaskNotFound,
  Unsupported,
  ValidationError,
} from "./errors.ts"
import type {
  Comment,
  CommentInput,
  Placement,
  Task,
  TaskId,
  TaskInput,
  TaskPatch,
  TodoList,
} from "./model.ts"

/** Optional operations a store supports (spec §1.5). */
export const Capabilities = Schema.Struct({
  groups: Schema.Boolean,
  reorder: Schema.Boolean,
  renameGroup: Schema.Boolean,
  comments: Schema.Boolean,
  promote: Schema.Boolean,
  cancel: Schema.Boolean,
  add: Schema.Boolean,
  remove: Schema.Boolean,
})
export type Capabilities = typeof Capabilities.Type

export const allCapabilities: Capabilities = {
  groups: true,
  reorder: true,
  renameGroup: true,
  comments: true,
  promote: true,
  cancel: true,
  add: true,
  remove: true,
}

/**
 * The adapter contract: one method per operation in spec §1.4. Every
 * implementation must pass the conformance suite in `@lemol/todo-md/spec/testing`.
 */
export class TodoStore extends Context.Service<
  TodoStore,
  {
    readonly capabilities: Capabilities
    load(): Effect.Effect<TodoList, StoreError>
    get(id: TaskId): Effect.Effect<Task, TaskNotFound | StoreError>
    listDone(): Effect.Effect<ReadonlyArray<Task>, StoreError>
    add(
      input: TaskInput,
      placement?: Placement,
    ): Effect.Effect<Task, ValidationError | TaskNotFound | Unsupported | StoreError>
    update(
      id: TaskId,
      patch: TaskPatch,
    ): Effect.Effect<Task, TaskNotFound | ValidationError | StoreError>
    move(
      id: TaskId,
      placement: Placement,
    ): Effect.Effect<
      Task,
      TaskNotFound | InvalidTransition | ValidationError | Unsupported | StoreError
    >
    complete(id: TaskId): Effect.Effect<Task, TaskNotFound | InvalidTransition | StoreError>
    /** Abandons an open task: it becomes done with outcome `cancelled` (spec §1.4). */
    cancel(
      id: TaskId,
      reason: string,
    ): Effect.Effect<
      Task,
      TaskNotFound | InvalidTransition | ValidationError | Unsupported | StoreError
    >
    reopen(id: TaskId): Effect.Effect<Task, TaskNotFound | InvalidTransition | StoreError>
    remove(id: TaskId): Effect.Effect<void, TaskNotFound | Unsupported | StoreError>
    renameGroup(
      from: string,
      to: string,
    ): Effect.Effect<void, GroupNotFound | ValidationError | Unsupported | StoreError>
    comment(
      id: TaskId,
      input: CommentInput,
    ): Effect.Effect<Comment, TaskNotFound | ValidationError | Unsupported | StoreError>
    /** Gives the task its own document (spec §2.9); a no-op when it already has one. */
    promote(id: TaskId): Effect.Effect<Task, TaskNotFound | Unsupported | StoreError>
    diagnostics(): Effect.Effect<ReadonlyArray<Diagnostic>, StoreError>
  }
>()("@lemol/todo-md/spec/TodoStore") {}
