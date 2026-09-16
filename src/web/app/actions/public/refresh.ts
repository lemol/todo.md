export type RefreshDecision = "reload" | "notice"

export const refreshDecision = (dirty: boolean): RefreshDecision => (dirty ? "notice" : "reload")

export const markDirtyOnInput = (event: Event): boolean =>
  event.type === "input" || event.type === "change"

/** What a page's live region listens to. */
export interface LiveRegion {
  /** The page's project, or `null` on a hub page. */
  readonly project: string | null
  /** The hub event kinds a hub page listens to; empty on a project page. */
  readonly events: ReadonlyArray<string>
}

export interface LiveEvent {
  readonly kind: string
  readonly project?: string
}

/**
 * A hub page refreshes on the kinds it declares, whatever project they name; a
 * project page refreshes only on its own project's events.
 */
export const shouldRefresh = (region: LiveRegion, event: LiveEvent): boolean =>
  region.events.length > 0
    ? region.events.includes(event.kind)
    : region.project !== null && event.project === region.project
