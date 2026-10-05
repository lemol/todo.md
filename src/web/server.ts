import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/http"
import { GitSource } from "../git/index.ts"
import { fsSource, Hub } from "../hub/index.ts"
import { JiraSource } from "../jira/index.ts"
import type { HubRuntime } from "./app/middleware/project.tsx"
import { createAppRouter } from "./app/router.ts"

export interface ServerOptions {
  readonly cwd: string
  readonly dir?: string
  /** A registered project's name; exclusive with `dir`. */
  readonly project?: string
  readonly port: number
  readonly host: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly username: string
  /** The hub's directory: `$TODO_MD_HOME`, else `<userHome>/.todo-md`. */
  readonly home: string
  readonly userHome: string
}

export const startServer = async (options: ServerOptions) => {
  if (options.project !== undefined && options.dir !== undefined) {
    throw new Error("use --project or --dir, not both")
  }

  const runtime = ManagedRuntime.make(
    Layer.unwrap(
      Effect.map(
        Effect.all([
          GitSource.make({ env: options.env }),
          JiraSource.make({ env: options.env }).pipe(Effect.provide(FetchHttpClient.layer)),
        ]),
        ([gitSource, jiraSource]) =>
          Hub.layer({
            home: options.home,
            userHome: options.userHome,
            sources: [fsSource, gitSource, jiraSource],
          }),
      ),
    ).pipe(Layer.provide(BunServices.layer)),
  )

  const hubRuntime: HubRuntime = { runPromise: (effect) => runtime.runPromise(effect) }
  let startup: string

  try {
    const info = await runtime.runPromise(
      Effect.flatMap(Hub, (hub) =>
        hub.resolve({
          ...(options.project !== undefined ? { project: options.project } : {}),
          ...(options.dir !== undefined ? { dir: options.dir } : {}),
          cwd: options.cwd,
        }),
      ),
    )

    startup = info.name
  } catch (error) {
    await runtime.dispose()
    throw error
  }

  let app: ReturnType<typeof createAppRouter>

  try {
    app = createAppRouter({
      runtime: hubRuntime,
      startup,
      cwd: options.cwd,
      author: options.env.TODO_MD_AUTHOR ?? options.username,
      hosts: ["localhost", "127.0.0.1", "::1", options.host],
    })
  } catch (error) {
    await runtime.dispose()
    throw error
  }

  let port = options.port
  let server: ReturnType<typeof Bun.serve>

  try {
    while (true) {
      try {
        server = Bun.serve({ port, hostname: options.host, fetch: (request) => app.fetch(request) })
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error

        port += 1
      }
    }
  } catch (error) {
    await app.close()
    await runtime.dispose()
    throw error
  }

  let closed = false

  return {
    server,
    port: server.port,
    project: startup,
    close: async () => {
      if (closed) return

      closed = true
      await app.close()
      await runtime.dispose()
      server.stop()
    },
  }
}
