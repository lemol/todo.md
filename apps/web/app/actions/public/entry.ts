import { refreshDecision } from "./refresh.ts"

export const startLiveRefresh = () => {
  let dirty = false
  document.addEventListener(
    "input",
    () => {
      dirty = true
    },
    true,
  )
  document.addEventListener(
    "change",
    () => {
      dirty = true
    },
    true,
  )
  const events = new EventSource("/events")
  events.addEventListener("changed", async () => {
    if (refreshDecision(dirty) === "notice") {
      document.querySelector("[data-reload-notice]")?.removeAttribute("hidden")
      return
    }
    try {
      const response = await fetch(location.href, { headers: { Accept: "text/html" } })
      const html = await response.text()
      const parsed = new DOMParser().parseFromString(html, "text/html")
      const next = parsed.querySelector("[data-live-region]")
      const current = document.querySelector("[data-live-region]")
      if (next && current) current.replaceWith(next)
      dirty = false
    } catch {
      document.querySelector("[data-reload-notice]")?.removeAttribute("hidden")
    }
  })
}

if (typeof document !== "undefined") startLiveRefresh()
