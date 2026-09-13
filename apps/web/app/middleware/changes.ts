import { createContextKey, type Middleware } from "remix/router"

export interface ListChanges {
  readonly subscribe: (listener: () => void) => () => void
}

export const changesContext = createContextKey<ListChanges>()

export const loadChanges = (changes: ListChanges): Middleware => (context, next) => {
  context.set(changesContext, changes)
  return next()
}

export const makeFakeChanges = (): ListChanges & { emit(): void; listenerCount(): number } => {
  const listeners = new Set<() => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit() {
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size,
  }
}
