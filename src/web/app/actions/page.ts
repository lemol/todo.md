import type { RenderFunction } from "remix/middleware/render"
import type { RequestContext } from "remix/router"
import type { ProjectInfo } from "../../../hub/index.ts"
import type { Capabilities, Diagnostic } from "../../../spec/index.ts"
import { type assetEntryContext, assetEntryOf } from "../middleware/assets.ts"
import {
  capabilitiesContext,
  projectInfoContext,
  runTodo,
  type TodoRuntime,
  type todoRuntimeContext,
} from "../middleware/todo.ts"
import { diagnosticCounts } from "../ui/format.ts"

export type WebContext = RequestContext<Record<string, string>>

export const renderPage = (
  context: WebContext,
  node: Parameters<RenderFunction>[0],
  init?: ResponseInit,
): Response => (context as WebContext & { readonly render: RenderFunction }).render(node, init)

export interface FlashMessage {
  readonly message: string
  readonly tone: "info" | "warning" | "error"
}

interface WebSession {
  get(key: string): unknown
  flash(key: string, value: unknown): void
}

export const runtimeContext = (context: WebContext) =>
  context as { readonly get: (key: typeof todoRuntimeContext) => TodoRuntime }

export const capabilitiesOf = (context: WebContext) =>
  (context as { readonly get: (key: typeof capabilitiesContext) => Capabilities }).get(
    capabilitiesContext,
  )

export const projectOf = (context: WebContext): string =>
  (context as { readonly get: (key: typeof projectInfoContext) => ProjectInfo }).get(
    projectInfoContext,
  ).name

export const sessionOf = (context: WebContext): WebSession =>
  (context as WebContext & { readonly session: WebSession }).session

export const takeFlash = (context: WebContext): FlashMessage | undefined => {
  const value = sessionOf(context).get("flash")
  if (
    typeof value !== "object" ||
    value === null ||
    !("message" in value) ||
    typeof value.message !== "string" ||
    !("tone" in value) ||
    (value.tone !== "info" && value.tone !== "warning" && value.tone !== "error")
  )
    return undefined
  return { message: value.message, tone: value.tone }
}

export const setFlash = (context: WebContext, flash: FlashMessage): void =>
  sessionOf(context).flash("flash", flash)

export const scriptEntryOf = (context: WebContext) =>
  assetEntryOf(
    context as {
      readonly get: (key: typeof assetEntryContext) => ReturnType<typeof assetEntryOf>
    },
  )

export const loadChrome = async (context: WebContext) => {
  const [listing, diagnostics] = await Promise.all([
    runTodo(runtimeContext(context), (todo) => todo.list()),
    runTodo(runtimeContext(context), (todo) => todo.check()),
  ])
  if (!listing.ok) return { ok: false as const, error: listing.error }
  if (!diagnostics.ok) return { ok: false as const, error: diagnostics.error }
  return {
    ok: true as const,
    title: listing.value.title,
    groups: listing.value.sections.flatMap((section) =>
      section.name === undefined ? [] : [section.name],
    ),
    diagnostics: diagnostics.value as ReadonlyArray<Diagnostic>,
    diagnosticCounts: diagnosticCounts(diagnostics.value),
  }
}
