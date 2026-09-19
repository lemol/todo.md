/**
 * The `TodoStore` over a Jira project's mirror.
 *
 * Reads come from `mirror.json`, so a list opens instantly and offline; only
 * a key the mirror has never seen costs a request. Writing is not implemented
 * yet: this is the reading half of the source (task 06).
 */

import { Effect, Layer, Option } from "effect"
import type { SourceEnv } from "../hub/index.ts"
import {
  type Capabilities,
  type Comment,
  StoreError,
  type Task,
  type TaskId,
  type TodoList,
  TodoStore,
  Unsupported,
} from "../spec/index.ts"
import type { JiraClient } from "./client.ts"
import { asStoreError, type JiraError } from "./errors.ts"
import { commentsOf, type Issue, taskFromIssue } from "./mapping.ts"
import { type Mirror, readMirror } from "./mirror.ts"

/**
 * Nothing optional yet. `comments` arrives with the mutations, together with
 * complete, reopen and update; a store that claimed it now would fail the
 * conformance suite's comment cases.
 */
const capabilities: Capabilities = {
  groups: false,
  reorder: false,
  renameGroup: false,
  comments: false,
  promote: false,
  cancel: false,
  add: false,
  remove: false,
}

/**
 * An issue as a task, with all of its comments.
 *
 * Jira embeds only the first page of comments in an issue, so a busy issue
 * arrives truncated and costs one more request. Doing this while the mirror
 * is written keeps every later read free.
 */
export const taskFor = (
  client: JiraClient,
  issue: Issue,
  site: string,
): Effect.Effect<Task, JiraError> =>
  Effect.gen(function* () {
    const page = issue.fields?.comment
    const embedded = page?.comments ?? []
    const task = taskFromIssue(issue, { site })
    if ((page?.total ?? embedded.length) <= embedded.length) return task
    const comments: ReadonlyArray<Comment> = commentsOf(yield* client.comments(issue.key))
    return { ...task, comments } satisfies Task
  })

export interface JiraStoreOptions {
  /** The project's name; the list's title. */
  readonly name: string
  /** The project's data directory, holding `mirror.json`. */
  readonly dir: string
  readonly site: string
  readonly client: JiraClient
}

const notImplemented = (operation: string) =>
  Effect.fail(
    new StoreError({
      message: `jira: ${operation} is not implemented yet; this project is read-only`,
    }),
  )

const unsupported = (operation: string) => Effect.fail(new Unsupported({ operation }))

export const make = (
  options: JiraStoreOptions,
): Effect.Effect<TodoStore["Service"], never, SourceEnv> =>
  Effect.gen(function* () {
    const env = yield* Effect.context<SourceEnv>()
    const { name, dir, site, client } = options

    /** The mirror, or the one thing the user can do about not having it. */
    const mirror: Effect.Effect<Mirror, StoreError> = readMirror(dir).pipe(
      Effect.provideContext(env),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new StoreError({ message: `${name} is not synced; run \`todo sync ${name}\`` }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    )

    /** An issue Jira knows but the mirror does not. */
    const fetch = (id: TaskId) =>
      Effect.flatMap(client.issue(id), (issue) => taskFor(client, issue, site)).pipe(
        Effect.mapError(asStoreError),
      )

    return TodoStore.of({
      capabilities,

      load: () =>
        Effect.map(
          mirror,
          (current): TodoList => ({
            title: name,
            description: "",
            ungrouped: current.open,
            groups: [],
          }),
        ),

      listDone: () => Effect.map(mirror, (current) => current.done),

      get: (id) =>
        Effect.flatMap(mirror, (current) => {
          const known = [...current.open, ...current.done].find((task) => task.id === id)
          return known === undefined ? fetch(id) : Effect.succeed(known)
        }),

      diagnostics: () => Effect.succeed([]),

      // Jira issues are created and deleted in Jira (spec §1.5); core guards
      // these before the store ever sees them.
      add: () => unsupported("add"),
      remove: () => unsupported("remove"),
      move: () => unsupported("move"),
      renameGroup: () => unsupported("renameGroup"),
      promote: () => unsupported("promote"),
      cancel: () => unsupported("cancel"),
      comment: () => unsupported("comment"),

      complete: () => notImplemented("complete"),
      reopen: () => notImplemented("reopen"),
      update: () => notImplemented("update"),
    })
  })

/** A `TodoStore` over the project's mirror. */
export const layer = (options: JiraStoreOptions): Layer.Layer<TodoStore, never, SourceEnv> =>
  Layer.effect(TodoStore, make(options))
