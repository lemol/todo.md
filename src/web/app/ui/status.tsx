/** @jsxImportSource remix/component */

import { Badge, type BadgeTone } from "@lemol/ui/remix"
import type { DateTime } from "effect"
import type { RemixNode } from "remix/component"
import { type ProjectStatus, statusText } from "../../../hub/index.ts"

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

export const badgeToneForStatus = (status: ProjectStatus): BadgeTone => {
  const tone = statusTone(status)
  switch (tone) {
    case "ready":
      return "success"
    case "blocked":
      return "warning"
    case "error":
      return "danger"
    case "muted":
      return "neutral"
  }
}

/** A project's sync status as a badge; the words come from the hub. */
export const syncStatusBadge = (status: ProjectStatus, now: DateTime.Utc): RemixNode => (
  <Badge tone={badgeToneForStatus(status)}>{statusText(status, now)}</Badge>
)
