import type { ScriptEntry } from "remix/assets"
import { createContextKey, type Middleware } from "remix/router"
import type { AppAssets } from "../assets.ts"

export const assetEntryContext = createContextKey<ScriptEntry>()

export const loadAssetEntry =
  (assets: AppAssets): Middleware =>
  async (context, next) => {
    context.set(assetEntryContext, await assets.getScriptEntry("app/actions/public/entry.ts"))

    return next()
  }

export const assetEntryOf = (context: {
  readonly get: (key: typeof assetEntryContext) => ScriptEntry
}): ScriptEntry => context.get(assetEntryContext)
