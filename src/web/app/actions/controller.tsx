/** @jsxImportSource remix/ui */

import { AppShell, Nav } from "@lemol/ui/mini"
import { Document as MiniDocument } from "@lemol/ui/mini/document"
import { DateTime, Deferred, Effect, Fiber, Stream } from "effect"
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
import { Document, ErrorPage, escapeHtml } from "../ui/document.tsx"
import { diagnosticCounts } from "../ui/format.ts"
import { CheckPage, DonePage } from "../ui/secondary.tsx"
import { syncStatusBadge } from "../ui/status.tsx"
import { dashboardAction, goAction } from "./dashboard/controller.tsx"
import { parseTaskFilter } from "./forms.ts"
import {
  capabilitiesOf,
  hubRuntimeOf,
  projectInfoOf,
  projectOf,
  renderPage,
  runtimeContext,
  scriptEntryOf,
  takeFlash,
  type WebContext,
} from "./page.ts"
import { respond, respondDefect } from "./respond.tsx"
import { projectSyncAction, syncAllAction } from "./sync/controller.tsx"

const switcherOf = async (runtime: HubRuntime) => {
  const projects = await runtime.runPromise(Effect.flatMap(Hub, (hub) => hub.projects()))
  return projects.map((info) => ({ name: info.name, registered: info.registered }))
}

const boardSyncChrome = (project: string, info: ReturnType<typeof projectInfoOf>, back: string) => {
  if (!info.syncable) return ""
  const now = DateTime.nowUnsafe()
  return `${syncStatusBadge(info.status, now)} <form method="post" action="${routes.project.sync.href({ project })}" class="inline"><input type="hidden" name="back" value="${escapeHtml(back)}"><button class="secondary" type="submit">Sync</button></form>`
}

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
    const back = `${url.pathname}${url.search}`
    const info = projectInfoOf(context)
    const flash = takeFlash(context)
    const switcher = await switcherOf(hubRuntimeOf(context))
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
          back,
          syncChrome: boardSyncChrome(project, info, back),
          ...(addValues === undefined ? {} : { addValues }),
          ...(addIssues === undefined ? {} : { addIssues }),
        })}
        switcher={switcher}
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
    const switcher = await switcherOf(hubRuntimeOf(context))
    return renderPage(
      context,
      <Document
        title={listing.value.title}
        project={project}
        pageTitle={`Done · ${listing.value.title}`}
        content={DonePage(project, listing.value.done)}
        switcher={switcher}
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
    const switcher = await switcherOf(hubRuntimeOf(context))
    const counts = diagnosticCounts(diagnostics.value)
    const errors = counts.error
    const warnings = counts.warning
    const checkLabel =
      errors > 0 || warnings > 0
        ? `Check (${errors > 0 ? `${errors} errors` : `${warnings} warnings`})`
        : "Check"
    const nav = (
      <Nav
        items={[
          { href: routes.dashboard.href(), label: "Dashboard" },
          { href: routes.projects.index.href(), label: "Projects" },
          { href: routes.project.board.href({ project }), label: "Board" },
          { href: routes.project.done.href({ project }), label: "Done" },
          { href: routes.project.check.href({ project }), label: checkLabel, current: true },
        ]}
      />
    )
    const switcherNode =
      switcher.length === 0 ? null : (
        <form class="switcher" method="get" action={routes.go.href()}>
          <label class="visually-hidden" for="switch-project">
            Project
          </label>
          <select id="switch-project" name="project" data-submit-on-change>
            {switcher.map((entry) => (
              <option
                value={entry.name}
                key={entry.name}
                {...(entry.name === project ? { selected: true } : {})}
              >
                {entry.registered ? entry.name : `${entry.name} (not registered)`}
              </option>
            ))}
          </select>
          <button class="secondary" type="submit">
            Go
          </button>
        </form>
      )
    return renderPage(
      context,
      <MiniDocument title={`Check · ${listing.value.title}`} entry={scriptEntryOf(context)}>
        <AppShell
          brand={listing.value.title}
          brandHref={routes.project.board.href({ project })}
          nav={nav}
          actions={switcherNode}
        >
          {flash === undefined ? null : (
            <div class={`flash ${flash.tone}`} role="status">
              {flash.message}
            </div>
          )}
          <div class="reload-notice info" data-reload-notice hidden>
            The list changed. <a href={routes.project.board.href({ project })}>Reload</a>
          </div>
          <div data-live-region data-project={project}>
            <CheckPage project={project} diagnostics={diagnostics.value} />
          </div>
        </AppShell>
      </MiniDocument>,
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
    actions: {
      board: (context) => renderBoard(context),
      done,
      check,
      sync: projectSyncAction(options),
    },
  })

/**
 * Acquires the hub change subscription before returning the response. This
 * handshake ensures a source event immediately after fetch resolves cannot be
 * lost; aborting the request interrupts the consumer and ends the watcher.
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
    const ready = await runtime.runPromise(Deferred.make<void>())
    fiber = await runtime.runPromise(
      Effect.gen(function* () {
        const hub = yield* Hub
        const consumer = Effect.scoped(
          Effect.gen(function* () {
            const changes = yield* hub.subscribeChanges
            yield* Deferred.succeed(ready, undefined)
            yield* Stream.runForEach(changes, (change) => Effect.sync(() => send(change)))
          }),
        )
        return yield* Effect.forkDetach(consumer)
      }),
    )
    await runtime.runPromise(Deferred.await(ready))
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
      dashboard: dashboardAction(options),
      go: goAction(options),
      sync: syncAllAction(options),
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
