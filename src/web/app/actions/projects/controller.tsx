/** @jsxImportSource remix/ui */

import { DateTime, Effect, Result } from "effect"
import { redirect } from "remix/response/redirect"
import { createController } from "remix/router"
import { Hub, projectInputFrom } from "../../../../hub/index.ts"
import type { HubRuntime } from "../../middleware/project.tsx"
import { routes } from "../../routes.ts"
import { Document } from "../../ui/document.tsx"
import { type ProjectsOptions, ProjectsPage } from "../../ui/projects.tsx"
import { parseProjectForm } from "../forms.ts"
import { renderPage, scriptEntryOf, setFlash, takeFlash, type WebContext } from "../page.ts"
import { respondDefect } from "../respond.tsx"

const LIVE_EVENTS = ["registry", "synced"]

const renderProjects = async (
  runtime: HubRuntime,
  context: WebContext,
  extra: Omit<ProjectsOptions, "projects" | "sources" | "now"> = {},
  status = 200,
): Promise<Response> => {
  const projects = await runtime.runPromise(Effect.flatMap(Hub, (hub) => hub.projects()))
  const flash = takeFlash(context)
  return renderPage(
    context,
    <Document
      title="todo.md"
      pageTitle="Projects · todo.md"
      content={ProjectsPage({
        projects,
        sources: [...new Set(projects.map((info) => info.source).filter((kind) => kind !== ""))],
        now: DateTime.nowUnsafe(),
        ...extra,
      })}
      switcher={projects.map((info) => ({ name: info.name, registered: info.registered }))}
      liveEvents={LIVE_EVENTS}
      scriptEntry={scriptEntryOf(context)}
      {...(flash === undefined ? {} : { flash })}
    />,
    { status },
  )
}

export const createProjectsController = (options: {
  readonly runtime: HubRuntime
  readonly cwd: string
}) =>
  createController(routes.projects, {
    actions: {
      index: async (context) => {
        try {
          const renaming = new URL(context.request.url).searchParams.get("rename") ?? undefined
          return await renderProjects(
            options.runtime,
            context as WebContext,
            renaming === undefined ? {} : { renaming },
          )
        } catch (defect) {
          return respondDefect(context as WebContext, defect)
        }
      },

      add: async (context) => {
        try {
          const web = context as WebContext
          const values = parseProjectForm(context.get(FormData) as FormData)
          if (values.issues.length > 0) {
            return await renderProjects(
              options.runtime,
              web,
              { values, issues: values.issues },
              422,
            )
          }
          const input = projectInputFrom(
            values.target,
            {
              cwd: options.cwd,
              ...(values.source === undefined ? {} : { source: values.source }),
              ...(values.name === "" ? {} : { name: values.name }),
            },
            (cwd, relative) => {
              if (relative.startsWith("/")) return relative
              const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd
              return `${base}/${relative}`
            },
          )
          const result = await options.runtime.runPromise(
            Effect.result(Effect.flatMap(Hub, (hub) => hub.add(input))),
          )
          if (Result.isFailure(result)) {
            return await renderProjects(
              options.runtime,
              web,
              { values, issues: [result.failure.message] },
              422,
            )
          }
          setFlash(web, { message: `Added project ${result.success.name}.`, tone: "info" })
          return redirect(routes.project.board.href({ project: result.success.name }), 303)
        } catch (defect) {
          return respondDefect(context as WebContext, defect)
        }
      },

      rename: async (context) => {
        try {
          const web = context as WebContext
          const from = String(web.params.name ?? "")
          const to = String((context.get(FormData) as FormData).get("to") ?? "").trim()
          if (to === "") {
            return await renderProjects(
              options.runtime,
              web,
              { issues: ["A new name is required"], renaming: from },
              422,
            )
          }
          const result = await options.runtime.runPromise(
            Effect.result(Effect.flatMap(Hub, (hub) => hub.rename(from, to))),
          )
          if (Result.isFailure(result)) {
            return await renderProjects(
              options.runtime,
              web,
              { issues: [result.failure.message], renaming: from },
              422,
            )
          }
          setFlash(web, { message: `Renamed ${from} to ${to}.`, tone: "info" })
          return redirect(routes.projects.index.href(), 303)
        } catch (defect) {
          return respondDefect(context as WebContext, defect)
        }
      },

      remove: async (context) => {
        try {
          const web = context as WebContext
          const name = String(web.params.name ?? "")
          const force = String((context.get(FormData) as FormData).get("force") ?? "") !== ""
          const result = await options.runtime.runPromise(
            Effect.result(Effect.flatMap(Hub, (hub) => hub.remove(name, { force }))),
          )
          if (Result.isFailure(result)) {
            const error = result.failure
            if (error._tag === "SourceError") {
              return await renderProjects(
                options.runtime,
                web,
                { refusal: { name, message: error.message } },
                422,
              )
            }
            return await renderProjects(options.runtime, web, { issues: [error.message] }, 422)
          }
          setFlash(web, { message: `Removed project ${name}.`, tone: "info" })
          return redirect(routes.projects.index.href(), 303)
        } catch (defect) {
          return respondDefect(context as WebContext, defect)
        }
      },
    },
  })
