/** @jsxImportSource remix/ui */
import { Effect } from "effect"
import { redirect } from "remix/response/redirect"
import { createController } from "remix/router"
import { Unsupported } from "../../../../spec/index.ts"
import type { HubRuntime } from "../../middleware/project.tsx"
import { loadProject } from "../../middleware/project.tsx"
import { authorContext, runTodo } from "../../middleware/todo.ts"
import { routes } from "../../routes.ts"
import { Document } from "../../ui/document.tsx"
import { showId } from "../../ui/format.ts"
import { EditTaskPage, RemoveTaskPage, TaskPage, valuesOf } from "../../ui/task.tsx"
import { renderBoard } from "../controller.tsx"
import {
  localBack,
  normalizeDependencies,
  parseAddForm,
  parseCancelForm,
  parseCommentForm,
  parseEditForm,
  parseMoveForm,
} from "../forms.ts"
import {
  capabilitiesOf,
  loadChrome,
  projectOf,
  renderPage,
  runtimeContext,
  scriptEntryOf,
  setFlash,
  takeFlash,
  type WebContext,
} from "../page.ts"
import { errorDescription, respond, respondDefect } from "../respond.tsx"

const formOf = (context: WebContext): FormData => context.get(FormData) as FormData
const idOf = (context: WebContext): string =>
  String(context.params.id ?? "").replace(/^0+(?=\d)/, "")
const tagOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : undefined

const renderTask = async (
  context: WebContext,
  id: string,
  moveIssues: ReadonlyArray<string> = [],
  status = 200,
): Promise<Response> => {
  const project = projectOf(context)
  const [detail, chrome] = await Promise.all([
    runTodo(runtimeContext(context), (todo) => todo.show(id)),
    loadChrome(context),
  ])
  if (!detail.ok) return respond(context, detail.error)
  if (!chrome.ok) return respond(context, chrome.error)
  const flash = takeFlash(context)
  return renderPage(
    context,
    <Document
      title={chrome.title}
      project={project}
      pageTitle={`${showId(detail.value.view.task.id)} ${detail.value.view.task.title}`}
      diagnostics={chrome.diagnosticCounts}
      scriptEntry={scriptEntryOf(context)}
      {...(flash === undefined ? {} : { flash })}
    >
      <TaskPage
        project={project}
        detail={detail.value}
        capabilities={capabilitiesOf(context)}
        author={String(context.get(authorContext))}
        groups={chrome.groups}
        moveIssues={moveIssues}
      />
    </Document>,
    { status },
  )
}

const renderRemove = async (
  context: WebContext,
  id: string,
  issues: ReadonlyArray<string> = [],
  status = 200,
): Promise<Response> => {
  // Asking before deleting only makes sense when the store can delete.
  if (!capabilitiesOf(context).remove)
    return respond(context, new Unsupported({ operation: "remove" }))
  const project = projectOf(context)
  const [detail, chrome] = await Promise.all([
    runTodo(runtimeContext(context), (todo) => todo.show(id)),
    loadChrome(context),
  ])
  if (!detail.ok) return respond(context, detail.error)
  if (!chrome.ok) return respond(context, chrome.error)
  const task = detail.value.view.task
  return renderPage(
    context,
    <Document
      title={chrome.title}
      project={project}
      pageTitle={`Remove ${showId(task.id)} · ${chrome.title}`}
      diagnostics={chrome.diagnosticCounts}
      scriptEntry={scriptEntryOf(context)}
    >
      <RemoveTaskPage
        project={project}
        task={task}
        dependents={detail.value.blocks.map((view) => view.task)}
        issues={issues}
      />
    </Document>,
    { status },
  )
}

const renderEdit = async (
  context: WebContext,
  id: string,
  values?: ReturnType<typeof parseEditForm>,
  issues: ReadonlyArray<string> = [],
  status = 200,
): Promise<Response> => {
  const project = projectOf(context)
  const [detail, chrome] = await Promise.all([
    runTodo(runtimeContext(context), (todo) => todo.show(id)),
    loadChrome(context),
  ])
  if (!detail.ok) return respond(context, detail.error)
  if (!chrome.ok) return respond(context, chrome.error)
  const task = detail.value.view.task
  return renderPage(
    context,
    <Document
      title={chrome.title}
      project={project}
      pageTitle={`Edit ${showId(task.id)} · ${chrome.title}`}
      diagnostics={chrome.diagnosticCounts}
      scriptEntry={scriptEntryOf(context)}
    >
      <EditTaskPage
        project={project}
        task={task}
        values={values ?? valuesOf(task)}
        issues={issues}
      />
    </Document>,
    { status },
  )
}

export const createTasksController = (options: {
  readonly runtime: HubRuntime
  readonly author: string
}) =>
  createController(routes.project.tasks, {
    middleware: [loadProject(options)],
    actions: {
      add: async (context) => {
        try {
          // The board offers no form without `add`, and a 422 rendered from it
          // would lose its issues along with it: refuse before parsing.
          if (!capabilitiesOf(context).add)
            return respond(context, new Unsupported({ operation: "add" }))
          const form = formOf(context)
          const parsed = parseAddForm(form)
          const submitted = {
            title: parsed.title,
            group: String(form.get("group") ?? "").trim(),
            newGroup: parsed.newGroup,
          }
          if (parsed.issues.length > 0) return renderBoard(context, 422, submitted, parsed.issues)
          const result = await runTodo(runtimeContext(context), (todo) =>
            todo.add(
              { title: parsed.title },
              parsed.group === "" ? undefined : { group: parsed.group },
            ),
          )
          const project = projectOf(context)
          if (result.ok)
            return redirect(routes.project.tasks.show.href({ project, id: result.value.id }), 303)
          if (tagOf(result.error) === "ValidationError")
            return renderBoard(
              context,
              422,
              submitted,
              (result.error as { readonly issues: ReadonlyArray<string> }).issues,
            )
          return respond(context, result.error)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      show: async (context) => {
        try {
          return await renderTask(context, idOf(context))
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      edit: async (context) => {
        try {
          return await renderEdit(context, idOf(context))
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      update: async (context) => {
        try {
          const id = idOf(context)
          const values = parseEditForm(formOf(context))
          if (values.title === "")
            return renderEdit(context, id, values, ["Title is required"], 422)
          const result = await runTodo(runtimeContext(context), (todo) =>
            todo.update(id, {
              title: values.title,
              description: values.description,
              tags: [...(values.tags ? values.tags.split(/[\s,]+/).filter(Boolean) : [])],
              assignee: values.assignee === "" ? null : values.assignee,
              dependsOn: normalizeDependencies(values.dependsOn),
            }),
          )
          const project = projectOf(context)
          if (result.ok)
            return redirect(routes.project.tasks.show.href({ project, id: result.value.id }), 303)
          if (tagOf(result.error) === "ValidationError")
            return renderEdit(
              context,
              id,
              values,
              (result.error as { readonly issues: ReadonlyArray<string> }).issues,
              422,
            )
          return respond(context, result.error)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      complete: async (context) => {
        try {
          const project = projectOf(context)
          const form = formOf(context)
          const back = localBack(form.get("back")?.toString(), project)
          const result = await runTodo(runtimeContext(context), (todo) =>
            todo.complete(idOf(context)),
          )
          if (!result.ok) {
            if (tagOf(result.error) !== "InvalidTransition") return respond(context, result.error)
            setFlash(context, { message: errorDescription(result.error), tone: "warning" })
            return redirect(back, 303)
          }
          const unblocked = result.value.unblocked.map((view) => showId(view.task.id)).join(", ")
          setFlash(context, {
            message: `Completed ${showId(result.value.task.id)}.${
              unblocked === "" ? "" : ` Now ready: ${unblocked}`
            }`,
            tone: "info",
          })
          return redirect(back, 303)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      cancel: async (context) => {
        try {
          const project = projectOf(context)
          const form = formOf(context)
          const back = localBack(form.get("back")?.toString(), project)
          const values = parseCancelForm(form)
          const result = await runTodo(runtimeContext(context), (todo) =>
            todo.cancel(idOf(context), values.reason),
          )
          if (!result.ok) {
            if (tagOf(result.error) !== "InvalidTransition") return respond(context, result.error)
            setFlash(context, { message: errorDescription(result.error), tone: "warning" })
            return redirect(back, 303)
          }
          // Unlike complete, cancelling unblocks nothing: no "now ready" list.
          setFlash(context, {
            message: `Cancelled ${showId(result.value.id)}.`,
            tone: "info",
          })
          return redirect(back, 303)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      reopen: async (context) => {
        try {
          const project = projectOf(context)
          const id = idOf(context)
          const back = routes.project.tasks.show.href({ project, id })
          const result = await runTodo(runtimeContext(context), (todo) => todo.reopen(id))
          if (!result.ok) {
            if (tagOf(result.error) !== "InvalidTransition") return respond(context, result.error)
            setFlash(context, { message: errorDescription(result.error), tone: "warning" })
            return redirect(back, 303)
          }
          return redirect(routes.project.tasks.show.href({ project, id: result.value.id }), 303)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      comments: async (context) => {
        try {
          const project = projectOf(context)
          const id = idOf(context)
          const values = parseCommentForm(formOf(context))
          const author = values.author || String(context.get(authorContext) ?? "unknown")
          const result = await runTodo(runtimeContext(context), (todo) =>
            todo.comment(id, { author, body: values.body }),
          )
          return result.ok
            ? redirect(routes.project.tasks.show.href({ project, id }), 303)
            : respond(context, result.error)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      move: async (context) => {
        try {
          const project = projectOf(context)
          const id = idOf(context)
          const form = formOf(context)
          const back = localBack(form.get("back")?.toString(), project)
          const parsed = parseMoveForm(form)
          if (parsed.issues.length > 0) return renderTask(context, id, parsed.issues, 422)
          const anchored = parsed.before !== undefined || parsed.after !== undefined
          const result = await runTodo(runtimeContext(context), (todo) =>
            Effect.gen(function* () {
              if (anchored)
                return yield* todo.move(id, {
                  ...(parsed.before === undefined ? {} : { before: parsed.before }),
                  ...(parsed.after === undefined ? {} : { after: parsed.after }),
                })
              const group = parsed.group === "" ? undefined : parsed.group
              if (parsed.position === "top") {
                const section = (yield* todo.list()).sections.find((s) => s.name === group)
                const first = section?.tasks.find((view) => view.task.id !== id)?.task
                if (first !== undefined) return yield* todo.move(id, { before: first.id })
              }
              return yield* todo.move(id, group === undefined ? {} : { group })
            }),
          )
          if (!result.ok) {
            const tag = tagOf(result.error)
            if (tag === "ValidationError")
              return renderTask(
                context,
                id,
                (result.error as { readonly issues: ReadonlyArray<string> }).issues,
                422,
              )
            if (tag !== "InvalidTransition") return respond(context, result.error)
            setFlash(context, { message: errorDescription(result.error), tone: "warning" })
            return redirect(back, 303)
          }
          if (!anchored)
            setFlash(context, {
              message: `Moved ${showId(result.value.id)} to ${result.value.group ?? "the ungrouped tasks"}.`,
              tone: "info",
            })
          return redirect(back, 303)
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      confirmRemove: async (context) => {
        try {
          return await renderRemove(context, idOf(context))
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },

      remove: async (context) => {
        try {
          const project = projectOf(context)
          const id = idOf(context)
          const force = formOf(context).get("force") === "1"
          const result = await runTodo(runtimeContext(context), (todo) =>
            Effect.gen(function* () {
              const { task } = (yield* todo.show(id)).view
              yield* todo.remove(id, { force })
              return task
            }),
          )
          if (!result.ok) {
            if (tagOf(result.error) === "HasDependents")
              return renderRemove(context, id, [errorDescription(result.error)], 422)
            return respond(context, result.error)
          }
          setFlash(context, {
            message: `Removed ${showId(result.value.id)} ${result.value.title}.`,
            tone: "info",
          })
          return redirect(
            result.value.status === "done"
              ? routes.project.done.href({ project })
              : routes.project.board.href({ project }),
            303,
          )
        } catch (defect) {
          return respondDefect(context, defect)
        }
      },
    },
  })
