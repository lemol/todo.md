export type RefreshDecision = "reload" | "notice"

export const refreshDecision = (dirty: boolean): RefreshDecision => (dirty ? "notice" : "reload")

export const markDirtyOnInput = (event: Event): boolean =>
  event.type === "input" || event.type === "change"
