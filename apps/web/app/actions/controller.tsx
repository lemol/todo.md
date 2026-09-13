import type { TaskFilter } from "@lemol/todo-md/core"
import type { RequestContext } from "remix/router"
import { createController } from "remix/router"
import { assetsContext } from "../assets.ts"
import { changesContext } from "../middleware/changes.ts"
import { runTodo, type TodoRuntime, type todoRuntimeContext } from "../middleware/todo.ts"
import { routes } from "../routes.ts"
import { escapeHtml, renderDocument } from "../ui/document.tsx"
import { showId } from "../ui/format.ts"
import { parseTaskFilter } from "./forms.ts"

const contextRuntime = (context: RequestContext<any, any>) =>
  context as { readonly get: (key: typeof todoRuntimeContext) => TodoRuntime }

const responseFor = (
  content: string,
  title: string,
  status = 200,
  diagnostics = { error: 0, warning: 0 },
) =>
  new Response(renderDocument({ title, content, diagnostics }), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })

const boardContent = (listing: any, nextIds: ReadonlySet<string>, filter: TaskFilter) => {
  const sections = listing.sections
    .filter((section: any) => section.tasks.length > 0)
    .map((section: any) => {
      const rows = section.tasks
        .map((view: any) => {
          const task = view.task
          const chips = task.tags
            .map(
              (tag: string) => `<a href="?tag=${encodeURIComponent(tag)}">#${escapeHtml(tag)}</a>`,
            )
            .join(" ")
          const blocked =
            view.blockedBy.length === 0
              ? ""
              : `<small>blocked by ${view.blockedBy.map(showId).join(", ")}</small>`
          return `<div class="task-row${nextIds.has(task.id) ? " next" : ""}"><form method="post" action="${routes.tasks.complete.href({ id: task.id })}"><input type="hidden" name="back" value="${escapeHtml(`/${filter.state ? `?state=${filter.state}` : ""}`)}"><button aria-label="Complete ${escapeHtml(task.title)}" type="submit">□</button></form><code>${showId(task.id)}</code> <a href="${routes.tasks.show.href({ id: task.id })}">${escapeHtml(task.title)}</a><span>${chips} ${task.assignee === undefined ? "" : `@${escapeHtml(task.assignee)}`} <b>${view.state.toUpperCase()}</b></span>${blocked}</div>`
        })
        .join("")
      return `<section><h2>${escapeHtml(section.name ?? "Ungrouped")}</h2>${rows}</section>`
    })
    .join("")
  return `<h1>${escapeHtml(listing.title)}</h1><p>${escapeHtml(listing.description)}</p><p>${listing.sections.reduce((n: number, s: any) => n + s.tasks.length, 0)} open tasks</p>${sections || "<p>Nothing open. Add a task above.</p>"}<h2>Add task</h2><form method="post" action="${routes.tasks.add.href()}"><label>Title <input name="title" required></label><button type="submit">Add task</button></form>`
}

const board = async (context: RequestContext<any, any>) => {
  try {
    let filter: TaskFilter = {}
    try {
      filter = parseTaskFilter(new URL(context.request.url))
    } catch {
      return responseFor("<h1>400</h1><p>Invalid state filter</p>", "Bad request", 400)
    }
    const runtimeContext = contextRuntime(context)
    const [listing, next, diagnostics] = await Promise.all([
      runTodo(runtimeContext, (todo) => todo.list(filter)),
      runTodo(runtimeContext, (todo) => todo.next(filter)),
      runTodo(runtimeContext, (todo) => todo.check()),
    ])
    if (!listing.ok || !next.ok || !diagnostics.ok)
      return responseFor("<h1>500</h1><p>Todo store failure</p>", "Error", 500)
    const errors = diagnostics.value.filter((item: any) => item.severity === "error").length
    const warnings = diagnostics.value.filter((item: any) => item.severity === "warning").length
    return responseFor(
      boardContent(
        listing.value,
        new Set(next.value.slice(0, 1).map((item: any) => item.task.id)),
        filter,
      ),
      listing.value.title,
      200,
      { error: errors, warning: warnings },
    )
  } catch (defect) {
    return responseFor(`<h1>500</h1><p>${escapeHtml(defect)}</p>`, "Error", 500)
  }
}

export default createController(routes, {
  actions: {
    board,
    done: async (context) => {
      const result = await runTodo(contextRuntime(context), (todo) => todo.list({ status: "done" }))
      if (!result.ok) return responseFor("<h1>500</h1>", "Error", 500)
      const rows = result.value.done
        .map(
          (view: any) =>
            `<li><a href="${routes.tasks.show.href({ id: view.task.id })}">${showId(view.task.id)} ${escapeHtml(view.task.title)}</a> <small>${view.task.completedAt === undefined ? "Unknown" : String(view.task.completedAt).slice(0, 10)}</small></li>`,
        )
        .join("")
      return responseFor(`<h1>Done</h1><ul>${rows || "<li>Nothing done.</li>"}</ul>`, "Done")
    },
    check: async (context) => {
      const result = await runTodo(contextRuntime(context), (todo) => todo.check())
      if (!result.ok) return responseFor("<h1>500</h1>", "Error", 500)
      const items = result.value
        .map(
          (item: any) =>
            `<li><code>${escapeHtml(item.code)}</code> ${escapeHtml(item.message)}${item.taskId === undefined ? "" : ` <a href="${routes.tasks.show.href({ id: item.taskId })}">${showId(item.taskId)}</a>`}</li>`,
        )
        .join("")
      return responseFor(
        `<h1>Check</h1>${items ? `<ul>${items}</ul>` : '<p class="diagnostic">No diagnostics</p>'}`,
        "Check",
        200,
        {
          error: result.value.filter((item: any) => item.severity === "error").length,
          warning: result.value.filter((item: any) => item.severity === "warning").length,
        },
      )
    },
    events: (context) => {
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
          const emit = () =>
            controller.enqueue(encoder.encode("event: changed\\ndata: reload\\n\\n"))
          unsubscribe = (
            context as {
              get: (key: typeof changesContext) => {
                subscribe: (listener: () => void) => () => void
              }
            }
          )
            .get(changesContext)
            .subscribe(emit)
          heartbeat = setInterval(
            () => controller.enqueue(encoder.encode(": heartbeat\\n\\n")),
            15_000,
          )
          context.request.signal.addEventListener("abort", cleanup, { once: true })
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
    },
    assets: async (context) => {
      const assets = (
        context as {
          get: (key: typeof assetsContext) => {
            fetch: (request: Request) => Promise<Response | undefined>
          }
        }
      ).get(assetsContext)
      return (await assets.fetch(context.request)) ?? new Response("Not Found", { status: 404 })
    },
  },
})
