/** @jsxImportSource remix/ui */
import type { TaskFilter } from "@lemol/todo-md/core"
import type { RequestContext } from "remix/router"
import { createController } from "remix/router"
import { assetsContext } from "../assets.ts"
import { changesContext } from "../middleware/changes.ts"
import { runTodo } from "../middleware/todo.ts"
import { routes } from "../routes.ts"
import { type AddValues, BoardPage } from "../ui/board.tsx"
import { Document, ErrorPage } from "../ui/document.tsx"
import { diagnosticCounts } from "../ui/format.ts"
import { CheckPage, DonePage } from "../ui/secondary.tsx"
import { parseTaskFilter } from "./forms.ts"
import {
  capabilitiesOf,
  renderPage,
  runtimeContext,
  scriptEntryOf,
  takeFlash,
  type WebContext,
} from "./page.ts"
import { respond, respondDefect } from "./respond.tsx"

export const renderBoard = async (
  context: WebContext,
  status = 200,
  addValues?: AddValues,
  addIssues?: ReadonlyArray<string>,
): Promise<Response> => {
  try {
    let filter: TaskFilter
    try {
      filter = parseTaskFilter(new URL(context.request.url))
    } catch {
      return renderPage(
        context,
        <ErrorPage
          status={400}
          message="Invalid state filter."
          scriptEntry={scriptEntryOf(context)}
        />,
        { status: 400 },
      )
    }
    const [listing, next, diagnostics] = await Promise.all([
      runTodo(runtimeContext(context), (todo) => todo.list(filter)),
      runTodo(runtimeContext(context), (todo) => todo.next()),
      runTodo(runtimeContext(context), (todo) => todo.check()),
    ])
    if (!listing.ok) return respond(context, listing.error)
    if (!next.ok) return respond(context, next.error)
    if (!diagnostics.ok) return respond(context, diagnostics.error)
    const url = new URL(context.request.url)
    const flash = takeFlash(context)
    return renderPage(
      context,
      <Document
        title={listing.value.title}
        content={BoardPage({
          listing: listing.value,
          nextIds: new Set(next.value.slice(0, 1).map((item) => item.task.id)),
          capabilities: capabilitiesOf(context),
          back: `${url.pathname}${url.search}`,
          ...(addValues === undefined ? {} : { addValues }),
          ...(addIssues === undefined ? {} : { addIssues }),
        })}
        diagnostics={diagnosticCounts(diagnostics.value)}
        scriptEntry={scriptEntryOf(context)}
        {...(flash === undefined ? {} : { flash })}
      />,
      { status },
    )
  } catch (defect) {
    return respondDefect(context, defect)
  }
}

const done = async (context: WebContext): Promise<Response> => {
  try {
    const [listing, diagnostics] = await Promise.all([
      runTodo(runtimeContext(context), (todo) => todo.list({ status: "done" })),
      runTodo(runtimeContext(context), (todo) => todo.check()),
    ])
    if (!listing.ok) return respond(context, listing.error)
    if (!diagnostics.ok) return respond(context, diagnostics.error)
    const flash = takeFlash(context)
    return renderPage(
      context,
      <Document
        title={listing.value.title}
        pageTitle={`Done · ${listing.value.title}`}
        content={DonePage(listing.value.done)}
        diagnostics={diagnosticCounts(diagnostics.value)}
        scriptEntry={scriptEntryOf(context)}
        {...(flash === undefined ? {} : { flash })}
      />,
    )
  } catch (defect) {
    return respondDefect(context, defect)
  }
}

const check = async (context: WebContext): Promise<Response> => {
  try {
    const [listing, diagnostics] = await Promise.all([
      runTodo(runtimeContext(context), (todo) => todo.list()),
      runTodo(runtimeContext(context), (todo) => todo.check()),
    ])
    if (!listing.ok) return respond(context, listing.error)
    if (!diagnostics.ok) return respond(context, diagnostics.error)
    const flash = takeFlash(context)
    return renderPage(
      context,
      <Document
        title={listing.value.title}
        pageTitle={`Check · ${listing.value.title}`}
        content={CheckPage(diagnostics.value)}
        diagnostics={diagnosticCounts(diagnostics.value)}
        scriptEntry={scriptEntryOf(context)}
        {...(flash === undefined ? {} : { flash })}
      />,
    )
  } catch (defect) {
    return respondDefect(context, defect)
  }
}

const events = (context: RequestContext): Response => {
  const encoder = new TextEncoder()
  let unsubscribe: () => void = () => undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false
  const cleanup = () => {
    if (closed) return
    closed = true
    unsubscribe()
    if (heartbeat !== undefined) clearInterval(heartbeat)
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (text: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          cleanup()
        }
      }
      unsubscribe = (
        context as {
          get: (key: typeof changesContext) => {
            subscribe: (listener: () => void) => () => void
          }
        }
      )
        .get(changesContext)
        .subscribe(() => enqueue("event: changed\ndata: reload\n\n"))
      heartbeat = setInterval(() => enqueue(": heartbeat\n\n"), 15_000)
      context.request.signal.addEventListener("abort", cleanup, { once: true })
      if (context.request.signal.aborted) cleanup()
    },
    cancel: cleanup,
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

export default createController(routes, {
  actions: {
    board: (context) => renderBoard(context),
    done,
    check,
    events,
    assets: async (context) => {
      const assets = (
        context as {
          get: (key: typeof assetsContext) => {
            fetch: (request: Request) => Promise<Response | null>
          }
        }
      ).get(assetsContext)
      return (await assets.fetch(context.request)) ?? new Response("Not Found", { status: 404 })
    },
  },
})
