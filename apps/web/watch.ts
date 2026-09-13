import { watch } from "node:fs"
import { basename, sep } from "node:path"
import type { ListChanges } from "./app/middleware/changes.ts"

export interface ClosableListChanges extends ListChanges {
  readonly close: () => void
}

export const watchList = (root: string): ClosableListChanges => {
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  const native = watch(root, { recursive: true }, (_event, filename) => {
    if (closed || filename === null) return
    const name = String(filename).replaceAll(sep, "/")
    const file = basename(name)
    if (file === ".todo.lock" || file.endsWith(".tmp")) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      for (const listener of listeners) listener()
    }, 100)
  })
  return {
    subscribe(listener) {
      if (closed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      if (closed) return
      closed = true
      if (timer !== undefined) clearTimeout(timer)
      listeners.clear()
      native.close()
    },
  }
}
