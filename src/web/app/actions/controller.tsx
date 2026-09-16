/** @jsxImportSource remix/ui */

import { Effect, Fiber, Stream } from "effect"
import { redirect } from "remix/response/redirect"
import type { RequestContext } from "remix/router"
import { createController } from "remix/router"
import type { TaskFilter } from "../../../core/index.ts"
import { Hub, type HubChange } from "../../../hub/index.ts"
import { assetsContext } from "../assets.ts"
import type { HubRuntime } from "../middleware/project.tsx"
import { loadProject } from "../middleware/project.tsx"
import { runTodo } from "../middleware/todo.ts"
import { routes } from "../routes.ts"
import { type AddValues, BoardPage } from "../ui/board.tsx"
import { Document, ErrorPage } from "../ui/document.tsx"
import { diagnosticCounts } from "../ui/format.ts"
import { CheckPage, DonePage } from "../ui/secondary.tsx"
import { parseTaskFilter } from "./forms.ts"
import {
  capabilitiesOf,
  projectOf,
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
    const project = projectOf(context)
    let filter: TaskFilter
    try {
      filter = parseTaskFilter(new URL(context.request.url))
    } catch {
      return renderPage(
        context,
        <ErrorPage
          status={400}
          message="Invalid state filter."
          project={project}
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
        project={project}
        content={BoardPage({
          project,
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
    const project = projectOf(context)
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
        project={project}
        pageTitle={`Done · ${listing.value.title}`}
        content={DonePage(project, listing.value.done)}
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
    const project = projectOf(context)
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
        project={project}
        pageTitle={`Check · ${listing.value.title}`}
        content={CheckPage(project, diagnostics.value)}
        diagnostics={diagnosticCounts(diagnostics.value)}
        scriptEntry={scriptEntryOf(context)}
        {...(flash === undefined ? {} : { flash })}
      />,
    )
  } catch (defect) {
    return respondDefect(context, defect)
  }
}

export const createRootController = (options: {
  readonly runtime: HubRuntime
  readonly author: string
}) =>
  createController(routes.project, {
    middleware: [loadProject(options)],
    actions: { board: (context) => renderBoard(context), done, check },
  })

/** `GET /`: redirects to the startup project's board until task 18 adds the dashboard. */
const boardRedirect =
  (startup: string) =>
  (_context: RequestContext): Response =>
    redirect(routes.project.board.href({ project: startup }), 302)

/**
 * Forks a `hub.changes` consumer and awaits the fork before returning, so
 * the subscription (`PubSub.subscribe` inside `src/hub/changes.ts`'s stream)
 * has at least started before this responds. Effect's fiber runtime runs a
 * forked fiber's synchronous prefix eagerly, but nothing here *guarantees*
 * the subscribe has completed by the time this returns — `test/web/events.test.ts`
 * treats a missed first event as possible and retries the seed that should
 * trigger it, the same way `test/hub/helpers.ts`'s `eventually` does for the
 * identical PubSub-subscribe-vs-publish race inside the hub's own test suite.
 */
const eventsAction =
  (runtime: HubRuntime) =>
  async (context: RequestContext): Promise<Response> => {
    const encoder = new TextEncoder()
    let closed = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined
    let fiber: Fiber.Fiber<void, never> | undefined
    const cleanup = () => {
      if (closed) return
      closed = true
      if (heartbeat !== undefined) clearInterval(heartbeat)
      if (fiber !== undefined) Effect.runFork(Fiber.interrupt(fiber))
    }
    const send = (change: HubChange) => {
      if (closed || controllerRef === undefined) return
      const data = change.kind === "registry" ? "{}" : JSON.stringify({ project: change.project })
      try {
        controllerRef.enqueue(encoder.encode(`event: ${change.kind}\ndata: ${data}\n\n`))
      } catch {
        cleanup()
      }
    }
    fiber = await runtime.runPromise(
      Effect.gen(function* () {
        const hub = yield* Hub
        return yield* Effect.forkDetach(
          Stream.runForEach(hub.changes, (change) => Effect.sync(() => send(change))),
        )
      }),
    )
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller
        heartbeat = setInterval(() => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"))
          } catch {
            cleanup()
          }
        }, 15_000)
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

export const createTopController = (options: {
  readonly runtime: HubRuntime
  readonly startup: string
}) =>
  createController(routes, {
    actions: {
      board: boardRedirect(options.startup),
      events: eventsAction(options.runtime),
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
