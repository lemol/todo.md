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

export type LiveRegionLoader = (signal: AbortSignal) => Promise<string>
export type LiveRegionApply = (html: string) => void

/**
 * Coalesces overlapping hub live refreshes: a newer event aborts the previous
 * fetch and stale completions never apply.
 */
export const createLiveRegionRefresher = () => {
  let generation = 0
  let abort: AbortController | undefined

  return async (load: LiveRegionLoader, apply: LiveRegionApply): Promise<void> => {
    abort?.abort()
    const controller = new AbortController()
    abort = controller
    const current = ++generation
    try {
      const html = await load(controller.signal)
      if (current !== generation) return
      apply(html)
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      throw error
    }
  }
}
