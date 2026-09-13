import { run } from "remix/ui"
import { routes } from "../../routes.ts"
import { markDirtyOnInput, refreshDecision } from "./refresh.ts"

export const startLiveRefresh = () => {
  let dirty = false
  document.addEventListener(
    "input",
    (event) => {
      dirty = markDirtyOnInput(event)
    },
    true,
  )
  document.addEventListener(
    "change",
    (event) => {
      dirty = markDirtyOnInput(event)
    },
    true,
  )
  const events = new EventSource(routes.events.href())
  events.addEventListener("changed", async () => {
    if (refreshDecision(dirty) === "notice") {
      document.querySelector("[data-reload-notice]")?.removeAttribute("hidden")
      return
    }
    try {
      const response = await fetch(location.href, { headers: { Accept: "text/html" } })
      if (!response.ok) throw new Error(`refresh failed with ${response.status}`)
      const html = await response.text()
      const parsed = new DOMParser().parseFromString(html, "text/html")
      const next = parsed.querySelector("[data-live-region]")
      const current = document.querySelector("[data-live-region]")
      if (!next || !current) throw new Error("refresh response has no live region")
      current.replaceWith(next)
      dirty = false
    } catch {
      document.querySelector("[data-reload-notice]")?.removeAttribute("hidden")
    }
  })
}

if (typeof document !== "undefined") {
  const app = run({
    async loadModule(moduleUrl, exportName) {
      const module = await import(moduleUrl)
      const component = module[exportName]
      if (typeof component !== "function")
        throw new Error(`Unknown component: ${moduleUrl}#${exportName}`)
      return component
    },
  })
  void app.ready().then(startLiveRefresh)
}
