/**
 * A project's sync status as one line for people. Frontends share this so the
 * CLI, the web app and any future TUI use the same words.
 */

import { DateTime } from "effect"
import type { ProjectStatus } from "./Source.ts"

/** `diverged`, `ahead 1`, `error: …`, `never synced` or `synced 3h ago`. */
export const statusText = (status: ProjectStatus, now: DateTime.Utc): string => {
  if (status.diverged === true) return "diverged"

  if (status.ahead !== undefined && status.ahead > 0) return `ahead ${status.ahead}`

  if (status.result === "error") return `error: ${status.error ?? "unknown error"}`

  if (status.result === "never" || status.lastSync === undefined) return "never synced"

  const seconds = Math.max(
    0,
    Math.floor((DateTime.toEpochMillis(now) - DateTime.toEpochMillis(status.lastSync)) / 1000),
  )

  if (seconds < 60) return "synced just now"

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) return `synced ${minutes}m ago`

  const hours = Math.floor(minutes / 60)

  if (hours < 24) return `synced ${hours}h ago`

  return `synced ${Math.floor(hours / 24)}d ago`
}
