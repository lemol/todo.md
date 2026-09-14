import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, ManagedRuntime, Option } from "effect"
import { TodoService } from "../core/index.ts"
import { FsTodoStore, findListRoot } from "../fs/index.ts"
import { allCapabilities } from "../spec/index.ts"
import { createAppRouter } from "./app/router.ts"
import { watchList } from "./watch.ts"

export interface ServerOptions {
  readonly cwd: string
  readonly dir?: string
  readonly port: number
  readonly host: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly username: string
}

export const resolveRoot = async (options: ServerOptions): Promise<string> => {
  const dir = options.dir
  if (dir !== undefined)
    return await import("node:path").then(({ resolve }) => resolve(options.cwd, dir))
  const found = await Effect.runPromise(
    findListRoot(options.cwd).pipe(Effect.provide(BunServices.layer)),
  )
  if (Option.isNone(found))
    throw new Error(`no todo.md list found from ${options.cwd}; run \`todo init\` or pass --dir`)
  return found.value
}

export const startServer = async (options: ServerOptions) => {
  const root = await resolveRoot(options)
  const runtime = ManagedRuntime.make(
    TodoService.layer.pipe(
      Layer.provide(FsTodoStore.layer({ root })),
      Layer.provide(BunServices.layer),
    ),
  )
  let changes: ReturnType<typeof watchList>
  try {
    changes = watchList(root)
  } catch (error) {
    await runtime.dispose()
    throw error
  }
  let app: ReturnType<typeof createAppRouter>
  try {
    app = createAppRouter({
      runtime,
      capabilities: allCapabilities,
      changes,
      author: options.env.TODO_MD_AUTHOR ?? options.username,
      hosts: ["localhost", "127.0.0.1", "::1", options.host],
    })
  } catch (error) {
    changes.close()
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
    changes.close()
    throw error
  }
  let closed = false
  return {
    server,
    port,
    close: async () => {
      if (closed) return
      closed = true
      await app.close()
      await runtime.dispose()
      changes.close()
      server.stop()
    },
  }
}
