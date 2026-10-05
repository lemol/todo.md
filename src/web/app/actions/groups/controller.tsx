/** @jsxImportSource remix/component */

import { redirect } from "remix/response/redirect"
import { createController } from "remix/router"
import { GroupNotFound, Unsupported } from "../../../../spec/index.ts"
import type { HubRuntime } from "../../middleware/project.tsx"
import { loadProject } from "../../middleware/project.tsx"
import { runTodo } from "../../middleware/todo.ts"
import { routes } from "../../routes.ts"
import { Document } from "../../ui/document.tsx"
import { RenameGroupPage } from "../../ui/groups.tsx"
import { parseRenameForm } from "../forms.ts"
import {
  capabilitiesOf,
  loadChrome,
  projectOf,
  renderPage,
  runtimeContext,
  scriptEntryOf,
  setFlash,
  type WebContext,
} from "../page.ts"
import { respond, respondDefect } from "../respond.tsx"

const renderRename = async (
  context: WebContext,
  from: string,
  to?: string,
  issues: ReadonlyArray<string> = [],
  status = 200,
): Promise<Response> => {
  if (!capabilitiesOf(context).renameGroup) {
    return respond(context, new Unsupported({ operation: "renameGroup" }))
  }

  const project = projectOf(context)
  const chrome = await loadChrome(context)

  if (!chrome.ok) return respond(context, chrome.error)

  if (!chrome.groups.includes(from)) return respond(context, new GroupNotFound({ name: from }))

  return renderPage(
    context,
    <Document
      title={chrome.title}
      project={project}
      pageTitle={`Rename ${from} · ${chrome.title}`}
      content={RenameGroupPage(project, from, to, issues)}
      diagnostics={chrome.diagnosticCounts}
      scriptEntry={scriptEntryOf(context)}
    />,
    { status },
  )
}

export const createGroupsController = (options: {
  readonly runtime: HubRuntime
  readonly author: string
}) =>
  createController(routes.project.groups, {
    middleware: [loadProject(options)],
    actions: {
      edit: async (context) => {
        try {
          const name = new URL(context.request.url).searchParams.get("name") ?? ""

          return await renderRename(context, name)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      rename: async (context) => {
        try {
          const project = projectOf(context)
          const { from, to } = parseRenameForm(context.get(FormData) as FormData)

          if (to === "") return renderRename(context, from, to, ["Name is required"], 422)

          if (to === from) return redirect(routes.project.board.href({ project }), 303)

          const result = await runTodo(runtimeContext(context), (todo) =>
            todo.renameGroup(from, to),
          )

          if (!result.ok) {
            if (result.error._tag === "ValidationError") {
              return renderRename(context, from, to, result.error.issues, 422)
            }

            return respond(context, result.error)
          }

          setFlash(context, { message: `Renamed group ${from} to ${to}.`, tone: "info" })

          return redirect(routes.project.board.href({ project }), 303)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },
    },
  })
