import "@lemol/ui/remix/compat"
import "@lemol/ui/remix/runtime"
import { run } from "remix/ui"
import { routes } from "../../routes.ts"
import {
  createLiveRegionRefresher,
  markDirtyOnInput,
  refreshDecision,
  shouldRefresh,
} from "./refresh.ts"

export const startLiveRefresh = () => {
  let dirty = false
  const refreshLiveRegion = createLiveRegionRefresher()
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
  const onChange = async (event: MessageEvent) => {
    const page = document.querySelector("[data-live-region]")
    if (page === null) return
    const region = {
      project: page.getAttribute("data-project"),
      events: (page.getAttribute("data-live-events") ?? "").split(" ").filter(Boolean),
    }
    let payload: { readonly project?: string } = {}
    try {
      payload = JSON.parse(event.data)
    } catch {
      // Malformed payloads are treated as "not for this page".
    }
    if (!shouldRefresh(region, { kind: event.type, ...payload })) return
    if (refreshDecision(dirty) === "notice") {
      document.querySelector("[data-reload-notice]")?.removeAttribute("hidden")
      return
    }
    try {
      await refreshLiveRegion(
        async (signal) => {
          const response = await fetch(location.href, {
            headers: { Accept: "text/html" },
            signal,
          })
          if (!response.ok) throw new Error(`refresh failed with ${response.status}`)
          return await response.text()
        },
        (html) => {
          const parsed = new DOMParser().parseFromString(html, "text/html")
          const next = parsed.querySelector("[data-live-region]")
          const current = document.querySelector("[data-live-region]")
          if (!next || !current) throw new Error("refresh response has no live region")
          current.replaceWith(next)
          dirty = false
        },
      )
    } catch {
      document.querySelector("[data-reload-notice]")?.removeAttribute("hidden")
    }
  }
  events.addEventListener("changed", onChange)
  events.addEventListener("synced", onChange)
  events.addEventListener("registry", onChange)

  document.addEventListener("change", (event) => {
    const target = event.target
    if (target instanceof HTMLSelectElement && target.hasAttribute("data-submit-on-change")) {
      target.form?.submit()
    }
  })
}

const triggerFlashToast = () => {
  const toastEl = document.getElementById("flash-toast")
  if (toastEl) {
    const invocation = new Event("command", { bubbles: false, cancelable: true, composed: true })
    Object.defineProperties(invocation, {
      command: { enumerable: true, value: "--dismiss-toast" },
      source: { enumerable: true, value: toastEl },
    })
    toastEl.dispatchEvent(invocation)
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "k") {
      event.preventDefault()
      const palette = document.getElementById("command-palette")
      if (palette instanceof HTMLDialogElement) {
        if (palette.open) palette.close()
        else palette.showModal()
      }
    }
  })

  const app = run({
    async loadModule(moduleUrl, exportName) {
      const module = await import(moduleUrl)
      const component = module[exportName]
      if (typeof component !== "function")
        throw new Error(`Unknown component: ${moduleUrl}#${exportName}`)
      return component
    },
  })
  void app.ready().then(() => {
    startLiveRefresh()
    triggerFlashToast()
  })
}
