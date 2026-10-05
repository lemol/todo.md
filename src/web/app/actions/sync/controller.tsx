/** @jsxImportSource remix/component */

import { Effect, Result } from "effect"
import { redirect } from "remix/response/redirect"
import { Hub, type SyncFailure, type SyncResult } from "../../../../hub/index.ts"
import type { HubRuntime } from "../../middleware/project.tsx"
import { routes } from "../../routes.ts"
import { hubBack } from "../forms.ts"
import { setFlash, type WebContext } from "../page.ts"
import { respondDefect } from "../respond.tsx"

/** `2 synced, 1 failed: work (auth)`, or `everything is up to date`. */
export const syncSummary = (outcomes: ReadonlyArray<SyncResult | SyncFailure>): string => {
  const failures = outcomes.filter((outcome): outcome is SyncFailure => "error" in outcome)
  const synced = outcomes.length - failures.length

  if (outcomes.length === 0) return "Nothing to sync."

  if (failures.length === 0) return `${synced} synced.`

  const named = failures.map((failure) => `${failure.project} (${failure.error.reason})`).join(", ")

  return `${synced} synced, ${failures.length} failed: ${named}`
}

const backOf = (context: WebContext, fallback: string): string =>
  hubBack(String((context.get(FormData) as FormData).get("back") ?? ""), fallback)

export const syncAllAction =
  (options: { readonly runtime: HubRuntime }) =>
  async (context: WebContext): Promise<Response> => {
    try {
      const back = backOf(context, routes.dashboard.href())
      const outcomes = await options.runtime.runPromise(Effect.flatMap(Hub, (hub) => hub.syncAll()))
      const failed = outcomes.some((outcome) => "error" in outcome)
      setFlash(context, {
        message: syncSummary(outcomes),
        tone: failed ? "error" : "info",
      })

      return redirect(back, 303)
    } catch (defect) {
      return respondDefect(context, defect)
    }
  }

export const projectSyncAction =
  (options: { readonly runtime: HubRuntime }) =>
  async (context: WebContext): Promise<Response> => {
    try {
      const name = String(context.params.project ?? "")
      const back = backOf(context, routes.dashboard.href())
      const result = await options.runtime.runPromise(
        Effect.result(Effect.flatMap(Hub, (hub) => hub.sync(name))),
      )

      setFlash(
        context,
        Result.isFailure(result)
          ? { message: `${name}: ${result.failure.message}`, tone: "error" }
          : { message: `${name}: ${result.success.summary}`, tone: "info" },
      )

      return redirect(back, 303)
    } catch (defect) {
      return respondDefect(context, defect)
    }
  }
