import { redirect } from "remix/response/redirect"
import { createController } from "remix/router"
import {
  authorContext,
  runTodo,
  type TodoRuntime,
  type todoRuntimeContext,
} from "../../middleware/todo.ts"
import { routes } from "../../routes.ts"
import { escapeHtml, renderDocument } from "../../ui/document.tsx"
import { showId } from "../../ui/format.ts"
import { markdownHtml } from "../../ui/markdown.tsx"
import {
  localBack,
  normalizeDependencies,
  parseAddForm,
  parseCommentForm,
  parseEditForm,
} from "../forms.ts"

const formOf = (context: { get: (key: typeof FormData) => FormData }): FormData =>
  context.get(FormData)

export default createController(routes.tasks, {
  actions: {
    add: async (context) => {
      const form = formOf(context as { get: (key: typeof FormData) => FormData })
      const parsed = parseAddForm(form)
      if (parsed.issues.length > 0)
        return new Response(`<h1>422</h1><p>${parsed.issues.join(", ")}</p>`, { status: 422 })
      const result = await runTodo(
        context as { get: (key: typeof todoRuntimeContext) => TodoRuntime },
        (todo) =>
          todo.add(
            { title: parsed.title },
            parsed.group === "" ? undefined : { group: parsed.group },
          ),
      )
      return result.ok
        ? redirect(routes.tasks.show.href({ id: result.value.id }), 303)
        : new Response("Bad request", { status: 400 })
    },
    show: async (context) => {
      const result = await runTodo(
        context as { get: (key: typeof todoRuntimeContext) => TodoRuntime },
        (todo) => todo.show(context.params.id.replace(/^0+(?=\d)/, "")),
      )
      if (!result.ok) return new Response("Not Found", { status: 404 })
      const detail = result.value
      const task = detail.view.task
      const dependencies = detail.dependencies
        .map(
          (dependency) =>
            `<li><a href="${routes.tasks.show.href({ id: dependency.id })}">${showId(dependency.id)} ${escapeHtml(dependency.title ?? "unknown")}</a> (${dependency.state})</li>`,
        )
        .join("")
      const comments = [...task.comments]
        .reverse()
        .map(
          (comment) =>
            `<article><small>${escapeHtml(comment.author)}</small><div>${markdownHtml(comment.body)}</div></article>`,
        )
        .join("")
      return new Response(
        renderDocument({
          title: task.title,
          content: `<h1>${escapeHtml(task.title)}</h1><p>State: ${detail.view.state}</p><div>${markdownHtml(task.description)}</div><h2>Dependencies</h2><ul>${dependencies}</ul><h2>Comments</h2>${comments || "<p>No comments.</p>"}<a href="${routes.tasks.edit.href({ id: task.id })}">Edit</a>`,
        }),
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      )
    },
    edit: async (context) =>
      new Response(
        `<h1>Edit</h1><form method="post" action="${routes.tasks.update.href({ id: context.params.id })}"><label>Title <input name="title"></label><label>Description <textarea name="description"></textarea></label><button>Save</button></form>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      ),
    update: async (context) => {
      const values = parseEditForm(formOf(context as { get: (key: typeof FormData) => FormData }))
      const result = await runTodo(
        context as { get: (key: typeof todoRuntimeContext) => TodoRuntime },
        (todo) =>
          todo.update(context.params.id.replace(/^0+(?=\d)/, ""), {
            title: values.title,
            description: values.description,
            tags: [...(values.tags ? values.tags.split(/[\s,]+/).filter(Boolean) : [])],
            assignee: values.assignee === "" ? null : values.assignee,
            dependsOn: normalizeDependencies(values.dependsOn),
          }),
      )
      return result.ok
        ? redirect(routes.tasks.show.href({ id: result.value.id }), 303)
        : new Response("Invalid task", { status: 422 })
    },
    complete: async (context) => {
      const back = localBack(
        formOf(context as { get: (key: typeof FormData) => FormData })
          .get("back")
          ?.toString(),
      )
      const _result = await runTodo(
        context as { get: (key: typeof todoRuntimeContext) => TodoRuntime },
        (todo) => todo.complete(context.params.id.replace(/^0+(?=\d)/, "")),
      )
      return redirect(back, 303)
    },
    reopen: async (context) => {
      const result = await runTodo(
        context as { get: (key: typeof todoRuntimeContext) => TodoRuntime },
        (todo) => todo.reopen(context.params.id.replace(/^0+(?=\d)/, "")),
      )
      return result.ok
        ? redirect(routes.tasks.show.href({ id: result.value.id }), 303)
        : new Response("Invalid task", { status: 400 })
    },
    comments: async (context) => {
      const values = parseCommentForm(
        formOf(context as { get: (key: typeof FormData) => FormData }),
      )
      const author = values.author || String(context.get(authorContext) ?? "unknown")
      const result = await runTodo(
        context as { get: (key: typeof todoRuntimeContext) => TodoRuntime },
        (todo) =>
          todo.comment(context.params.id.replace(/^0+(?=\d)/, ""), { author, body: values.body }),
      )
      return result.ok
        ? redirect(routes.tasks.show.href({ id: context.params.id }), 303)
        : new Response("Invalid comment", { status: 400 })
    },
  },
})
