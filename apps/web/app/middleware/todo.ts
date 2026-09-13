import { TodoService } from "@lemol/todo-md/core"
import type { Capabilities } from "@lemol/todo-md/spec"
import { Effect, Result } from "effect"
import { createContextKey, type Middleware } from "remix/router"

export interface TodoRuntime {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, TodoService>) => Promise<A>
}

export type TodoResult<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }

export const todoRuntimeContext = createContextKey<TodoRuntime>()
export const capabilitiesContext = createContextKey<Capabilities>()
export const authorContext = createContextKey<string>()

export const runTodo = async <A, E>(
  context: { readonly get: (key: typeof todoRuntimeContext) => TodoRuntime },
  use: (todo: TodoService["Service"]) => Effect.Effect<A, E>,
): Promise<TodoResult<A, E>> => {
  const result = await context
    .get(todoRuntimeContext)
    .runPromise(Effect.result(TodoService.use(use)))
  return Result.isSuccess(result)
    ? { ok: true, value: result.success }
    : { ok: false, error: result.failure }
}

export const loadTodo =
  (options: {
    readonly runtime: TodoRuntime
    readonly capabilities: Capabilities
    readonly author: string
  }): Middleware =>
  (context, next) => {
    context.set(todoRuntimeContext, options.runtime)
    context.set(capabilitiesContext, options.capabilities)
    context.set(authorContext, options.author)
    return next()
  }

export const taskId = (text: string): string =>
  /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : text
