import type { DateTime } from "effect"
import { type ProjectStatus, statusText } from "../../../hub/index.ts"
import { escapeHtml } from "./document.tsx"

/**
 * The pastel a status reads in. Badges always carry their text, so colour
 * never carries the meaning on its own.
 */
export const statusTone = (status: ProjectStatus): "ready" | "blocked" | "error" | "muted" => {
  if (status.diverged === true || status.result === "error") return "error"
  if (status.ahead !== undefined && status.ahead > 0) return "blocked"
  if (status.result === "never" || status.lastSync === undefined) return "muted"
  return "ready"
}

/** A project's sync status as a badge; the words come from the hub. */
export const syncStatusBadge = (status: ProjectStatus, now: DateTime.Utc): string =>
  `<span class="badge ${statusTone(status)} sync-status">${escapeHtml(statusText(status, now))}</span>`
