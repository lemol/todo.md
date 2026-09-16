/** @jsxImportSource remix/ui */

import { DateTime, Effect } from "effect"
import { redirect } from "remix/response/redirect"
import { Hub } from "../../../../hub/index.ts"
import type { HubRuntime } from "../../middleware/project.tsx"
import { routes } from "../../routes.ts"
import { DashboardPage } from "../../ui/dashboard.tsx"
import { Document, ErrorPage } from "../../ui/document.tsx"
import { renderPage, scriptEntryOf, takeFlash, type WebContext } from "../page.ts"
import { respondDefect } from "../respond.tsx"
import { InvalidQuery, parseDashboardQuery } from "./query.ts"

export const LIVE_EVENTS = ["changed", "synced", "registry"]

const badRequest = (context: WebContext, message: string): Response =>
  renderPage(
    context,
    <ErrorPage status={400} message={message} scriptEntry={scriptEntryOf(context)} />,
    { status: 400 },
  )

export const dashboardAction =
  (options: { readonly runtime: HubRuntime; readonly startup: string }) =>
  async (context: WebContext): Promise<Response> => {
    try {
      let query: ReturnType<typeof parseDashboardQuery>
      try {
        query = parseDashboardQuery(new URL(context.request.url))
      } catch (error) {
        if (error instanceof InvalidQuery) return badRequest(context, error.message)
        throw error
      }
      const { projects, overview, kinds } = await options.runtime.runPromise(
        Effect.gen(function* () {
          const hub = yield* Hub
          const all = yield* hub.projects()
          const kinds = yield* hub.sourceKinds()
          const startup = all.find((info) => info.name === options.startup)
          const unregisteredStartup =
            startup !== undefined && !startup.registered ? [startup.name] : []
          const wanted =
            query.overview.projects ??
            (unregisteredStartup.length === 0
              ? undefined
              : [
                  ...unregisteredStartup,
                  ...all.filter((info) => info.registered).map((info) => info.name),
                ])
          const view = yield* hub.overview({
            ...query.overview,
            ...(wanted === undefined ? {} : { projects: wanted }),
          })
          return {
            projects: all,
            overview: view,
            kinds,
          }
        }),
      )
      const flash = takeFlash(context)
      return renderPage(
        context,
        <Document
          title="todo.md"
          pageTitle="Projects · todo.md"
          content={DashboardPage({
            overview,
            projects,
            sources: kinds,
            query,
            now: DateTime.nowUnsafe(),
            syncable: projects.some((info) => info.syncable),
          })}
          switcher={projects.map((info) => ({
            name: info.name,
            registered: info.registered,
          }))}
          liveEvents={LIVE_EVENTS}
          scriptEntry={scriptEntryOf(context)}
          {...(flash === undefined ? {} : { flash })}
        />,
      )
    } catch (defect) {
      return respondDefect(context, defect)
    }
  }

/** `GET /go?project=`: the switcher without JavaScript. */
export const goAction =
  (options: { readonly runtime: HubRuntime }) =>
  async (context: WebContext): Promise<Response> => {
    try {
      const name = new URL(context.request.url).searchParams.get("project")?.trim() ?? ""
      const known = await options.runtime.runPromise(Effect.flatMap(Hub, (hub) => hub.projects()))
      if (!known.some((info) => info.name === name)) {
        return renderPage(
          context,
          <ErrorPage
            status={404}
            message={`No project named ${name}.`}
            scriptEntry={scriptEntryOf(context)}
          />,
          { status: 404 },
        )
      }
      return redirect(routes.project.board.href({ project: name }), 303)
    } catch (defect) {
      return respondDefect(context, defect)
    }
  }
