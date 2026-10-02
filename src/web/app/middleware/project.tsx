/** @jsxImportSource remix/component */
import { Effect, Result } from "effect"
import type { Middleware } from "remix/router"
import { TodoService } from "../../../core/index.ts"
import { Hub } from "../../../hub/index.ts"
import { renderPage, scriptEntryOf, type WebContext } from "../actions/page.ts"
import { ErrorPage } from "../ui/document.tsx"
import {
  authorContext,
  capabilitiesContext,
  hubRuntimeContext,
  projectInfoContext,
  type TodoRuntime,
  todoRuntimeContext,
} from "./todo.ts"

/** Runs effects that only need `Hub`; built once in `server.ts` from `Hub.layer`. */
export interface HubRuntime {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, Hub>) => Promise<A>
}

/** Puts the hub runtime on the context for routes that have no single project. */
export const provideHub =
  (runtime: HubRuntime): Middleware =>
  (context, next) => {
    context.set(hubRuntimeContext, runtime)
    return next()
  }

/**
 * For routes under `/p/:project`: resolves the project (same errors as the
 * CLI's `withTodo`), then puts its `TodoRuntime`, `Capabilities`, author and
 * `ProjectInfo` on the context. An unknown project renders a 404 page; any
 * other hub failure renders a 500 page with its message. Neither calls `next`.
 */
export const loadProject =
  (options: { readonly runtime: HubRuntime; readonly author: string }): Middleware =>
  async (context, next) => {
    const request = (context as WebContext).request
    if (
      request !== undefined &&
      request.method === "POST" &&
      new URL(request.url).pathname.endsWith("/sync")
    ) {
      return next()
    }
    const name = String((context as WebContext).params.project ?? "")
    const result = await options.runtime.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const hub = yield* Hub
          const info = yield* hub.resolve({ project: name, cwd: "" })
          const todo = yield* hub.todo(info.name)
          return { info, todo }
        }),
      ),
    )
    if (Result.isFailure(result)) {
      const error = result.failure
      const status = error._tag === "ProjectNotFound" ? 404 : 500
      return renderPage(
        context as WebContext,
        <ErrorPage
          status={status}
          message={error.message}
          scriptEntry={scriptEntryOf(context as WebContext)}
        />,
        { status },
      )
    }
    const { info, todo } = result.success
    context.set(projectInfoContext, info)
    context.set(authorContext, options.author)
    context.set(capabilitiesContext, todo.capabilities)
    context.set(todoRuntimeContext, {
      runPromise: (effect) =>
        options.runtime.runPromise(Effect.provideService(effect, TodoService, todo)),
    } satisfies TodoRuntime)
    return next()
  }
