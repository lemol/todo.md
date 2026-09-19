/**
 * What can go wrong against Jira, and how it reads to the rest of the hub.
 * One error with a reason, mapped into the hub's `SyncError` during a sync and
 * into the spec's store errors during an operation.
 */

import { Schema } from "effect"
import { SyncError } from "../hub/index.ts"
import { StoreError, TaskNotFound } from "../spec/index.ts"

/**
 * Why a call failed: the network never answered (`offline`), Jira refused the
 * credentials (`auth`), the issue is gone (`notFound`), or Jira said no for
 * any other reason, rate limiting included (`remote`).
 */
export const JiraReason = Schema.Literals(["offline", "auth", "notFound", "remote"])
export type JiraReason = typeof JiraReason.Type

export class JiraError extends Schema.TaggedError<JiraError>()("JiraError", {
  reason: JiraReason,
  message: Schema.String,
  /** The issue key, when the call was about one. */
  issue: Schema.optional(Schema.String),
}) {}

/** A failed sync of `project`; `notFound` is a remote problem from a sync's point of view. */
export const asSyncError = (project: string, error: JiraError): SyncError =>
  new SyncError({
    project,
    reason: error.reason === "notFound" ? "remote" : error.reason,
    message: error.message,
  })

/** A failed store operation. A missing issue is `TaskNotFound`, the rest is I/O. */
export const asStoreError = (error: JiraError): StoreError | TaskNotFound =>
  error.reason === "notFound" && error.issue !== undefined
    ? new TaskNotFound({ id: error.issue })
    : new StoreError({ message: error.message })
