import type { Middleware } from "remix/router"

export interface ScriptEntry {
  readonly href: string
}

export const assetEntryContext = new Map<object, ScriptEntry>()
export const loadAssetEntry = (): Middleware => (_context, next) => next()
