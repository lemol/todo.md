/**
 * The shape of what Jira's REST v3 sends, and how an issue becomes a `Task`.
 * Pure: everything here is a decode or a transformation, so the mapping can be
 * read and tested without a server.
 *
 * The schemas are deliberately forgiving. A field the query did not ask for is
 * absent, an empty one is `null`, and Jira adds fields over time; none of that
 * should stop a list from loading.
 */

import { DateTime, Option, Schema } from "effect"
import type { Comment, Extra, Task } from "../spec/index.ts"
import { adfToMarkdown } from "./adf.ts"

const Maybe = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema))

export const JiraUser = Schema.Struct({
  accountId: Maybe(Schema.String),
  displayName: Maybe(Schema.String),
})
export type JiraUser = typeof JiraUser.Type

const Named = Schema.Struct({ name: Maybe(Schema.String) })

const Status = Schema.Struct({
  name: Maybe(Schema.String),
  statusCategory: Maybe(Schema.Struct({ key: Maybe(Schema.String), name: Maybe(Schema.String) })),
})

const IssueLink = Schema.Struct({
  type: Maybe(Named),
  inwardIssue: Maybe(Schema.Struct({ key: Schema.String })),
  outwardIssue: Maybe(Schema.Struct({ key: Schema.String })),
})

export const JiraComment = Schema.Struct({
  id: Maybe(Schema.String),
  author: Maybe(JiraUser),
  created: Maybe(Schema.String),
  body: Schema.optional(Schema.Unknown),
})
export type JiraComment = typeof JiraComment.Type

/** Jira's embedded comment page; `total` above `maxResults` means it is truncated. */
export const CommentPage = Schema.Struct({
  comments: Maybe(Schema.Array(JiraComment)),
  startAt: Maybe(Schema.Number),
  maxResults: Maybe(Schema.Number),
  total: Maybe(Schema.Number),
})
export type CommentPage = typeof CommentPage.Type

export const Issue = Schema.Struct({
  key: Schema.String,
  fields: Schema.optional(
    Schema.Struct({
      summary: Maybe(Schema.String),
      description: Schema.optional(Schema.Unknown),
      labels: Maybe(Schema.Array(Schema.String)),
      assignee: Maybe(JiraUser),
      status: Maybe(Status),
      priority: Maybe(Named),
      issuelinks: Maybe(Schema.Array(IssueLink)),
      resolutiondate: Maybe(Schema.String),
      comment: Maybe(CommentPage),
      project: Maybe(Schema.Struct({ key: Maybe(Schema.String) })),
    }),
  ),
})
export type Issue = typeof Issue.Type

/** One page of `GET /search/jql`: `nextPageToken` is absent on the last page. */
export const SearchPage = Schema.Struct({
  issues: Maybe(Schema.Array(Issue)),
  nextPageToken: Maybe(Schema.String),
  isLast: Maybe(Schema.Boolean),
})
export type SearchPage = typeof SearchPage.Type

/** The fields every query asks for; anything else is not mapped. */
export const issueFields: ReadonlyArray<string> = [
  "summary",
  "description",
  "labels",
  "assignee",
  "status",
  "priority",
  "issuelinks",
  "resolutiondate",
  "comment",
  "project",
]

/**
 * A display name as a handle: lowercase, runs of non-alphanumerics joined with
 * a dash. `undefined` when nothing is left, since the model has no empty ones.
 */
export const slugOf = (name: string | null | undefined): string | undefined => {
  if (name === null || name === undefined) return undefined
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
  return slug === "" ? undefined : slug
}

/** Jira's timestamps (`2026-01-17T12:34:00.000+0000`) as an instant. */
const instantOf = (value: string | null | undefined): DateTime.Utc | undefined =>
  value === null || value === undefined ? undefined : Option.getOrUndefined(DateTime.make(value))

/** A summary as a title: one line, trimmed, and never empty. */
const titleOf = (summary: string | null | undefined, key: string): string => {
  const line = (summary ?? "").replace(/\s+/g, " ").trim()
  return line === "" ? key : line
}

const isDone = (issue: Issue): boolean =>
  issue.fields?.status?.statusCategory?.key?.toLowerCase() === "done"

/** The keys of the issues blocking this one: a "Blocks" link with this issue on the inward end. */
const dependsOnOf = (issue: Issue): ReadonlyArray<string> => [
  ...new Set(
    (issue.fields?.issuelinks ?? []).flatMap((link) =>
      link.type?.name?.toLowerCase() === "blocks" && link.inwardIssue != null
        ? [link.inwardIssue.key]
        : [],
    ),
  ),
]

/**
 * Comments newest first. A comment whose body renders empty, or whose date
 * Jira did not send, cannot be expressed in the model and is left out.
 */
export const commentsOf = (comments: ReadonlyArray<JiraComment>): ReadonlyArray<Comment> =>
  comments
    .flatMap((comment) => {
      const at = instantOf(comment.created)
      // Comment bodies are quoted inside the task's document, so their
      // headings start below its own (spec §2.6).
      const body = adfToMarkdown(comment.body, { headingShift: 3 }).trim()
      if (at === undefined || body === "") return []
      const author =
        slugOf(comment.author?.displayName) ?? slugOf(comment.author?.accountId) ?? "unknown"
      return [{ author, at, body } satisfies Comment]
    })
    .sort((left, right) => DateTime.toEpochMillis(right.at) - DateTime.toEpochMillis(left.at))

const extraOf = (issue: Issue, site: string): Extra => {
  const fields = issue.fields
  const entries: ReadonlyArray<readonly [string, string | undefined]> = [
    ["status", fields?.status?.name ?? undefined],
    ["priority", fields?.priority?.name ?? undefined],
    ["url", `${site.replace(/\/+$/, "")}/browse/${issue.key}`],
    ["project", fields?.project?.key ?? undefined],
    ["assignee_name", fields?.assignee?.displayName ?? undefined],
    ["assignee_account", fields?.assignee?.accountId ?? undefined],
  ]
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined))
}

export interface MappingOptions {
  /** The Jira site, for the `url` in `extra`. */
  readonly site: string
}

/** An issue as a task. Total: a field Jira left out simply does not appear. */
export const taskFromIssue = (issue: Issue, options: MappingOptions): Task => {
  const fields = issue.fields
  const done = isDone(issue)
  const assignee = slugOf(fields?.assignee?.displayName)
  const completedAt = done ? instantOf(fields?.resolutiondate) : undefined
  return {
    id: issue.key,
    title: titleOf(fields?.summary, issue.key),
    description: adfToMarkdown(fields?.description),
    status: done ? "done" : "open",
    tags: (fields?.labels ?? []).map((label) => label.trim()).filter((label) => label !== ""),
    ...(assignee === undefined ? {} : { assignee }),
    dependsOn: dependsOnOf(issue),
    comments: commentsOf(fields?.comment?.comments ?? []),
    ...(completedAt === undefined ? {} : { completedAt }),
    extra: extraOf(issue, options.site),
  }
}
