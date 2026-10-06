/**
 * Pulling Jira issues into an ordinary list, one way.
 *
 * Unlike the Jira source, the list stays the user's own: its tasks keep local
 * IDs, groups, order, dependencies and comments, and nothing is ever written
 * back to Jira. A pulled task remembers its issue in `extra.jira_id`; that
 * link is all a later pull needs to find it again.
 *
 * Planning is pure, so what a pull would do can be shown before it is done.
 */

import { Effect } from "effect"
import type {
  InvalidTransition,
  Placement,
  StoreError,
  Task,
  TaskId,
  TaskInput,
  TaskNotFound,
  TaskPatch,
  Unsupported,
  ValidationError,
} from "../spec/index.ts"
import { type JiraClient, searchAll } from "./client.ts"
import type { JiraError } from "./errors.ts"
import { taskFromIssue } from "./mapping.ts"

/** The `extra` field holding a pulled task's issue key. */
export const jiraIdField = "jira_id"

/** The issue key a task was pulled from, if it was. */
export const jiraIdOf = (task: Task): string | undefined => {
  const value = task.extra[jiraIdField]

  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

export type PullTargetError =
  | StoreError
  | TaskNotFound
  | ValidationError
  | Unsupported
  | InvalidTransition

/** The list a pull writes to: any `TodoService` fits. */
export interface PullTarget {
  tasks(): Effect.Effect<ReadonlyArray<Task>, StoreError>
  add(input: TaskInput, placement?: Placement): Effect.Effect<Task, PullTargetError>
  update(id: TaskId, patch: TaskPatch): Effect.Effect<Task, PullTargetError>
  complete(id: TaskId): Effect.Effect<unknown, PullTargetError>
  reopen(id: TaskId): Effect.Effect<unknown, PullTargetError>
  promote(id: TaskId): Effect.Effect<unknown, PullTargetError>
}

/** One thing a pull does to the list, for one issue. */
export type PullChange =
  | { readonly kind: "add"; readonly key: string; readonly input: TaskInput }
  | {
      readonly kind: "update"
      readonly key: string
      readonly id: TaskId
      readonly patch: TaskPatch
    }
  | { readonly kind: "complete"; readonly key: string; readonly id: TaskId }
  | { readonly kind: "reopen"; readonly key: string; readonly id: TaskId }

export interface PullPlan {
  readonly changes: ReadonlyArray<PullChange>
  /** Linked open tasks whose issue Jira no longer has, or no longer shows us. Left alone. */
  readonly missing: ReadonlyArray<string>
}

/** The linked task for each issue key; the first one wins if a key is linked twice. */
const linkedTasks = (local: ReadonlyArray<Task>): ReadonlyMap<string, Task> => {
  const byKey = new Map<string, Task>()

  for (const task of local) {
    const key = jiraIdOf(task)

    if (key !== undefined && !byKey.has(key)) byKey.set(key, task)
  }

  return byKey
}

/**
 * The fields of `local` that differ from `remote`, as a patch. Title,
 * description and assignee follow Jira. Labels and blockers are only ever
 * added, so the tags and dependencies given here survive a pull.
 */
const patchFor = (local: Task, remote: Task, localIdOf: (key: string) => TaskId | undefined) => {
  const tags = remote.tags.filter((tag) => !local.tags.includes(tag))
  const dependsOn = remote.dependsOn
    .map(localIdOf)
    .filter((id): id is TaskId => id !== undefined && id !== local.id)
    .filter((id) => !local.dependsOn.includes(id))

  const patch: { -readonly [K in keyof TaskPatch]: TaskPatch[K] } = {}

  if (remote.title !== local.title) patch.title = remote.title

  if (remote.description.trim() !== local.description.trim()) {
    patch.description = remote.description
  }

  if (remote.assignee !== local.assignee) patch.assignee = remote.assignee ?? null

  if (tags.length > 0) patch.tags = [...local.tags, ...new Set(tags)]

  if (dependsOn.length > 0) patch.dependsOn = [...local.dependsOn, ...new Set(dependsOn)]

  return patch
}

/**
 * What a pull changes, given the list's tasks and the issues as tasks (IDs
 * are issue keys). An open issue with no task is added; a done one is not,
 * since finished work has no place in a fresh list. A linked task follows its
 * issue: changed fields are patched, then it is completed or reopened as the
 * issue's status says, unless it was cancelled here. `linkedKeys` are the
 * issues that were looked for; one that did not come back is `missing`.
 */
export const planPull = (
  local: ReadonlyArray<Task>,
  issues: ReadonlyArray<Task>,
  linkedKeys: ReadonlyArray<string> = [],
): PullPlan => {
  const linked = linkedTasks(local)

  const localIdOf = (key: string) => linked.get(key)?.id

  const seen = new Set<string>()
  const changes: Array<PullChange> = []

  for (const remote of issues) {
    const key = remote.id

    if (seen.has(key)) continue

    seen.add(key)
    const task = linked.get(key)

    if (task === undefined) {
      if (remote.status === "done") continue

      const dependsOn = remote.dependsOn
        .map(localIdOf)
        .filter((id): id is TaskId => id !== undefined)

      changes.push({
        kind: "add",
        key,
        input: {
          title: remote.title,
          ...(remote.description.trim() === "" ? {} : { description: remote.description }),
          ...(remote.tags.length === 0 ? {} : { tags: [...new Set(remote.tags)] }),
          ...(remote.assignee === undefined ? {} : { assignee: remote.assignee }),
          ...(dependsOn.length === 0 ? {} : { dependsOn: [...new Set(dependsOn)] }),
          extra: { [jiraIdField]: key },
        },
      })
      continue
    }

    const patch = patchFor(task, remote, localIdOf)

    if (Object.keys(patch).length > 0) changes.push({ kind: "update", key, id: task.id, patch })

    if (remote.status === "done" && task.status === "open") {
      changes.push({ kind: "complete", key, id: task.id })
    }

    if (remote.status === "open" && task.status === "done" && task.outcome !== "cancelled") {
      changes.push({ kind: "reopen", key, id: task.id })
    }
  }

  const missing = linkedKeys.filter((key) => !seen.has(key) && linked.has(key))

  return { changes, missing }
}

/** What Jira says, for one pull: the query's issues, then the linked ones it left out. */
export interface PullIssues {
  readonly issues: ReadonlyArray<Task>
  /** The keys looked up one by one, because the query did not return them. */
  readonly looked: ReadonlyArray<string>
}

/**
 * The issues `jql` returns, plus each open linked task's issue the query
 * left out (completed, reassigned, moved), fetched by key so its status still
 * reaches the list. An issue Jira answers 404 for is simply absent.
 */
export const fetchIssues = Effect.fnUntraced(function* (
  client: JiraClient,
  options: { readonly site: string; readonly jql: string; readonly linked: ReadonlyArray<string> },
): Effect.fn.Return<PullIssues, JiraError> {
  const listed = yield* searchAll(client, options.jql)
  const keys = new Set(listed.map((issue) => issue.key))
  const looked = [...new Set(options.linked)].filter((key) => !keys.has(key))
  const fetched = yield* Effect.forEach(
    looked,
    (key) =>
      client.issue(key).pipe(
        Effect.map((issue) => [issue]),
        Effect.catchIf(
          (error) => error.reason === "notFound",
          () => Effect.succeed([]),
        ),
      ),
    { concurrency: 4 },
  )

  const issues = [...listed, ...fetched.flat()].map((issue) =>
    taskFromIssue(issue, { site: options.site }),
  )

  return { issues, looked }
})

export interface PullOptions {
  /** The Jira site, as the credentials name it. */
  readonly site: string
  /** The issues to pull. */
  readonly jql: string
  /** The group new tasks go to; absent adds them ungrouped. */
  readonly group?: string | undefined
  /** Give each new task with a description its own file (spec §2.9). */
  readonly files?: boolean | undefined
  /** Plan only: report what would change and write nothing. */
  readonly dryRun?: boolean | undefined
}

/** One change a pull made, or would make under `dryRun`. */
export interface PullEntry {
  readonly kind: PullChange["kind"]
  readonly key: string
  /** The local task; absent for an addition that was only planned. */
  readonly id?: TaskId | undefined
  readonly title: string
  /** The fields an update changed. */
  readonly fields?: ReadonlyArray<string> | undefined
}

export interface PullFailure {
  readonly kind: PullChange["kind"]
  readonly key: string
  readonly error: PullTargetError
}

export interface PullReport {
  readonly changes: ReadonlyArray<PullEntry>
  readonly missing: ReadonlyArray<string>
  readonly failures: ReadonlyArray<PullFailure>
}

/** The keys of the linked open tasks: Jira is asked about each one the query leaves out. */
const linkedOpenKeys = (local: ReadonlyArray<Task>): ReadonlyArray<string> =>
  local.flatMap((task) => {
    const key = jiraIdOf(task)

    return key !== undefined && task.status === "open" ? [key] : []
  })

/** The entry a change reports, titled as the issue is now. */
const entryOf = (change: PullChange, issues: ReadonlyArray<Task>): PullEntry => ({
  kind: change.kind,
  key: change.key,
  ...(change.kind === "add" ? {} : { id: change.id }),
  title:
    change.kind === "add"
      ? change.input.title
      : (issues.find((issue) => issue.id === change.key)?.title ?? change.key),
  ...(change.kind === "update" ? { fields: Object.keys(change.patch) } : {}),
})

/**
 * Pulls the issues `jql` returns into `target`. Everything Jira says is read
 * before the list is touched, so an unreachable site changes nothing. Each
 * change then stands alone: one the list refuses is reported in `failures`
 * and the rest still happen.
 */
export const pull = Effect.fnUntraced(function* (
  client: JiraClient,
  target: PullTarget,
  options: PullOptions,
): Effect.fn.Return<PullReport, StoreError | JiraError> {
  const local = yield* target.tasks()
  const { issues, looked } = yield* fetchIssues(client, {
    site: options.site,
    jql: options.jql,
    linked: linkedOpenKeys(local),
  })

  const plan = planPull(local, issues, looked)

  if (options.dryRun === true) {
    return {
      changes: plan.changes.map((change) => entryOf(change, issues)),
      missing: plan.missing,
      failures: [],
    }
  }

  const entries: Array<PullEntry> = []
  const failures: Array<PullFailure> = []
  const placement: Placement | undefined =
    options.group === undefined ? undefined : { group: options.group }

  const apply = (change: PullChange) =>
    Effect.gen(function* () {
      if (change.kind === "add") {
        const task = yield* target.add(change.input, placement)

        if (options.files === true && task.description.trim() !== "") {
          yield* target.promote(task.id)
        }

        return { ...entryOf(change, issues), id: task.id }
      }

      if (change.kind === "update") yield* target.update(change.id, change.patch)

      if (change.kind === "complete") yield* target.complete(change.id)

      if (change.kind === "reopen") yield* target.reopen(change.id)

      return entryOf(change, issues)
    }).pipe(
      Effect.tap((entry) => Effect.sync(() => entries.push(entry))),
      Effect.catch((error: PullTargetError) =>
        Effect.sync(() => failures.push({ kind: change.kind, key: change.key, error })),
      ),
    )

  yield* Effect.forEach(plan.changes, apply, { discard: true })

  // A new task's blockers may have been added after it, with no local ID to
  // depend on yet. A second plan, now that every task exists, links them.
  const added = new Set(entries.filter((entry) => entry.kind === "add").map((entry) => entry.key))

  if (added.size > 0) {
    const now = yield* target.tasks()
    const links = planPull(now, issues).changes.flatMap((change): ReadonlyArray<PullChange> =>
      change.kind === "update" && added.has(change.key) && change.patch.dependsOn !== undefined
        ? [{ ...change, patch: { dependsOn: change.patch.dependsOn } }]
        : [],
    )

    const before = entries.length

    yield* Effect.forEach(links, apply, { discard: true })
    // The additions already report these tasks; their links are part of them.
    entries.splice(before)
  }

  return { changes: entries, missing: plan.missing, failures }
})
