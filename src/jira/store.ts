/**
 * The `TodoStore` over a Jira project's mirror.
 *
 * Reads come from `mirror.json`, so a list opens instantly and offline; only
 * a key the mirror has never seen costs a request. Every mutation goes
 * straight to Jira, then re-fetches the issue and patches it into the mirror.
 */

import { Effect, Layer, Option } from "effect"
import type { SourceEnv } from "../hub/index.ts"
import {
  type Capabilities,
  type Comment,
  CommentInput,
  InvalidTransition,
  StoreError,
  type Task,
  type TaskId,
  TaskPatch,
  type TodoList,
  TodoStore,
  Unsupported,
  unique,
  ValidationError,
  validate,
} from "../spec/index.ts"
import type { JiraClient } from "./client.ts"
import { asStoreError, type JiraError } from "./errors.ts"
import { commentsOf, type Issue, type Transition, taskFromIssue } from "./mapping.ts"
import { type Mirror, patchMirror, readMirror } from "./mirror.ts"

/**
 * Comments, and nothing else optional. Issues are created and deleted in Jira,
 * which has its own ranking and no groups; only the summary and labels are
 * editable from here, and Jira signs a comment with the token's user.
 */
const capabilities: Capabilities = {
  groups: false,
  reorder: false,
  renameGroup: false,
  comments: true,
  promote: false,
  cancel: false,
  add: false,
  remove: false,
  edit: false,
  commentAuthor: false,
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
  /** The transition `complete` takes; else the first into the done category. */
  readonly doneTransition?: string | undefined
  /** The transition `reopen` takes; else the first into the to-do category. */
  readonly reopenTransition?: string | undefined
}

/** The fields `update` cannot send to Jira, in the order they are reported. */
const readOnly = ["description", "assignee", "dependsOn", "extra"] as const

/**
 * The transition named `name` when one is configured, else the first leading
 * into `category`. Failing names what is available, since that is what the
 * user needs to configure one.
 */
export const pickTransition = (
  transitions: ReadonlyArray<Transition>,
  options: {
    readonly name?: string | undefined
    readonly category: string
    readonly setting: string
  },
): Transition | string => {
  const { name, category, setting } = options
  const found =
    name === undefined
      ? transitions.find((one) => one.to?.statusCategory?.key?.toLowerCase() === category)
      : transitions.find((one) => one.name?.trim().toLowerCase() === name.trim().toLowerCase())
  if (found !== undefined) return found
  const available = transitions.map((one) => one.name ?? one.id)
  const offered =
    available.length === 0 ? "none are available" : `available: ${available.join(", ")}`
  return name === undefined
    ? `no transition leads to a ${category} status (${offered}); set ${setting}`
    : `no transition is named ${name} (${offered}); check ${setting}`
}

const unsupported = (operation: string) => Effect.fail(new Unsupported({ operation }))

export const make = (
  options: JiraStoreOptions,
): Effect.Effect<TodoStore["Service"], never, SourceEnv> =>
  Effect.gen(function* () {
    const env = yield* Effect.context<SourceEnv>()
    const { name, dir, site, client } = options
    const provided = <A, E>(effect: Effect.Effect<A, E, SourceEnv>) =>
      Effect.provideContext(effect, env)

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

    /** The task, from the mirror or else from Jira. */
    const find = (id: TaskId) =>
      Effect.flatMap(mirror, (current) => {
        const known = [...current.open, ...current.done].find((task) => task.id === id)
        return known === undefined ? fetch(id) : Effect.succeed(known)
      })

    /** The issue as Jira has it now, patched into the mirror. */
    const refreshed = (id: TaskId) =>
      Effect.tap(fetch(id), (task) => provided(patchMirror(dir, task)))

    /** Moves the issue through the transition `pick` chooses, then refreshes it. */
    const transitioned = (
      id: TaskId,
      pick: (transitions: ReadonlyArray<Transition>) => Transition | string,
    ) =>
      Effect.gen(function* () {
        const transitions = yield* client.transitions(id)
        const chosen = pick(transitions)
        if (typeof chosen === "string") {
          return yield* new StoreError({ message: `${id}: ${chosen}` })
        }
        yield* client.transition(id, chosen.id)
      }).pipe(
        Effect.mapError((error) => (error._tag === "JiraError" ? asStoreError(error) : error)),
        Effect.andThen(refreshed(id)),
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

      get: find,

      diagnostics: () => Effect.succeed([]),

      // Jira issues are created and deleted in Jira (spec §1.5); core guards
      // these before the store ever sees them.
      add: () => unsupported("add"),
      remove: () => unsupported("remove"),
      move: () => unsupported("move"),
      renameGroup: () => unsupported("renameGroup"),
      promote: () => unsupported("promote"),
      cancel: () => unsupported("cancel"),

      complete: (id) =>
        Effect.gen(function* () {
          const task = yield* find(id)
          if (task.status === "done") {
            return yield* new InvalidTransition({ id, status: "done", operation: "complete" })
          }
          return yield* transitioned(id, (transitions) =>
            pickTransition(transitions, {
              name: options.doneTransition,
              category: "done",
              setting: "done_transition",
            }),
          )
        }),

      reopen: (id) =>
        Effect.gen(function* () {
          const task = yield* find(id)
          if (task.status === "open") {
            return yield* new InvalidTransition({ id, status: "open", operation: "reopen" })
          }
          return yield* transitioned(id, (transitions) =>
            pickTransition(transitions, {
              name: options.reopenTransition,
              category: "new",
              setting: "reopen_transition",
            }),
          )
        }),

      // Jira keeps the description, assignee and links itself; only the
      // summary and labels are sent, and nothing is sent when a patch asks
      // for more.
      update: (id, patch) =>
        Effect.gen(function* () {
          const valid = yield* validate(TaskPatch, patch)
          const refused = readOnly.filter((field) => valid[field] !== undefined)
          if (refused.length > 0) {
            return yield* new ValidationError({
              issues: refused.map((field) => `${field} is read-only for Jira projects`),
            })
          }
          const fields = {
            ...(valid.title === undefined ? {} : { summary: valid.title }),
            ...(valid.tags === undefined ? {} : { labels: unique(valid.tags) }),
          }
          if (Object.keys(fields).length === 0) return yield* find(id)
          yield* client.edit(id, fields).pipe(Effect.mapError(asStoreError))
          return yield* refreshed(id)
        }),

      // Jira signs a comment with the token's user, so `input.author` is
      // checked like any input and then left out.
      comment: (id, input) =>
        Effect.gen(function* () {
          const valid = yield* validate(CommentInput, input)
          const created = yield* client
            .addComment(id, valid.body)
            .pipe(Effect.mapError(asStoreError))
          yield* refreshed(id)
          const [comment] = commentsOf([created])
          if (comment === undefined) {
            return yield* new StoreError({ message: `${id}: Jira returned an unreadable comment` })
          }
          return comment
        }),
    })
  })

/** A `TodoStore` over the project's mirror. */
export const layer = (options: JiraStoreOptions): Layer.Layer<TodoStore, never, SourceEnv> =>
  Layer.effect(TodoStore, make(options))
