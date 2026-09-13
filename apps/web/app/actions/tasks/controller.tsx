/** @jsxImportSource remix/ui */
import { redirect } from "remix/response/redirect"
import { createController } from "remix/router"
import { authorContext, runTodo } from "../../middleware/todo.ts"
import { routes } from "../../routes.ts"
import { Document } from "../../ui/document.tsx"
import { showId } from "../../ui/format.ts"
import { EditTaskPage, TaskPage, valuesOf } from "../../ui/task.tsx"
import { renderBoard } from "../controller.tsx"
import {
  localBack,
  normalizeDependencies,
  parseAddForm,
  parseCommentForm,
  parseEditForm,
} from "../forms.ts"
import {
  capabilitiesOf,
  loadChrome,
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

const renderTask = async (context: WebContext, id: string): Promise<Response> => {
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
      pageTitle={`${showId(detail.value.view.task.id)} ${detail.value.view.task.title}`}
      content={TaskPage({
        detail: detail.value,
        capabilities: capabilitiesOf(context),
        author: String(context.get(authorContext)),
      })}
      diagnostics={chrome.diagnosticCounts}
      scriptEntry={scriptEntryOf(context)}
      {...(flash === undefined ? {} : { flash })}
    />,
  )
}

const renderEdit = async (
  context: WebContext,
  id: string,
  values?: ReturnType<typeof parseEditForm>,
  issues: ReadonlyArray<string> = [],
  status = 200,
): Promise<Response> => {
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
      pageTitle={`Edit ${showId(task.id)} · ${chrome.title}`}
      content={EditTaskPage(task, values ?? valuesOf(task), issues)}
      diagnostics={chrome.diagnosticCounts}
      scriptEntry={scriptEntryOf(context)}
    />,
    { status },
  )
}

export default createController(routes.tasks, {
  actions: {
    add: async (context) => {
      try {
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
        if (result.ok) return redirect(routes.tasks.show.href({ id: result.value.id }), 303)
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
        if (values.title === "") return renderEdit(context, id, values, ["Title is required"], 422)
        const result = await runTodo(runtimeContext(context), (todo) =>
          todo.update(id, {
            title: values.title,
            description: values.description,
            tags: [...(values.tags ? values.tags.split(/[\s,]+/).filter(Boolean) : [])],
            assignee: values.assignee === "" ? null : values.assignee,
            dependsOn: normalizeDependencies(values.dependsOn),
          }),
        )
        if (result.ok) return redirect(routes.tasks.show.href({ id: result.value.id }), 303)
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
        const form = formOf(context)
        const back = localBack(form.get("back")?.toString())
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

    reopen: async (context) => {
      try {
        const id = idOf(context)
        const back = routes.tasks.show.href({ id })
        const result = await runTodo(runtimeContext(context), (todo) => todo.reopen(id))
        if (!result.ok) {
          if (tagOf(result.error) !== "InvalidTransition") return respond(context, result.error)
          setFlash(context, { message: errorDescription(result.error), tone: "warning" })
          return redirect(back, 303)
        }
        return redirect(routes.tasks.show.href({ id: result.value.id }), 303)
      } catch (defect) {
        return respondDefect(context, defect)
      }
    },

    comments: async (context) => {
      try {
        const id = idOf(context)
        const values = parseCommentForm(formOf(context))
        const author = values.author || String(context.get(authorContext) ?? "unknown")
        const result = await runTodo(runtimeContext(context), (todo) =>
          todo.comment(id, { author, body: values.body }),
        )
        return result.ok
          ? redirect(routes.tasks.show.href({ id }), 303)
          : respond(context, result.error)
      } catch (defect) {
        return respondDefect(context, defect)
      }
    },
  },
})
