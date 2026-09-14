import { userInfo } from "node:os"
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

export const helpText =
  "Usage: todo-web [options]\n\n--dir <path>  List directory\n--port <port> Port (default 4400)\n--host <host> Bind host (default 127.0.0.1)\n\nExamples:\n  bun run web -- --dir todo"

export const parseServerOptions = (
  args: ReadonlyArray<string>,
  base: Partial<ServerOptions> = {},
): ServerOptions | { readonly help: true } => {
  const options = {
    cwd: base.cwd ?? process.cwd(),
    port: base.port ?? 4400,
    host: base.host ?? "127.0.0.1",
    env: base.env ?? process.env,
    username: base.username ?? "unknown",
  }
  let dir: string | undefined
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--help" || arg === "-h") return { help: true }
    if (arg === "--dir" || arg === "--port" || arg === "--host") {
      const value = args[++i]
      if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${arg}`)
      if (arg === "--dir") dir = value
      if (arg === "--host") options.host = value
      if (arg === "--port") {
        const port = Number(value)
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new Error("port must be an integer from 1 to 65535")
        options.port = port
      }
      continue
    }
    throw new Error(`unknown option ${arg}`)
  }
  return dir === undefined ? options : { ...options, dir }
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

interface SignalSource {
  once(signal: NodeJS.Signals, listener: () => void): unknown
  off(signal: NodeJS.Signals, listener: () => void): unknown
}

export const installSignalHandlers = (
  close: () => Promise<void>,
  signals: SignalSource = process,
): (() => void) => {
  let closing = false
  const remove = () => {
    signals.off("SIGINT", shutdown)
    signals.off("SIGTERM", shutdown)
  }
  const shutdown = () => {
    if (closing) return
    closing = true
    remove()
    void close().catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
  }
  signals.once("SIGINT", shutdown)
  signals.once("SIGTERM", shutdown)
  return remove
}

export const main = async (args = process.argv.slice(2)) => {
  const options = parseServerOptions(args, { username: userInfo().username })
  if ("help" in options) {
    console.log(helpText)
    return
  }
  const started = await startServer(options)
  installSignalHandlers(started.close)
  console.log(`http://${options.host}:${started.port}`)
  if (!["127.0.0.1", "localhost", "::1"].includes(options.host))
    console.log("Warning: anyone who can reach this address can edit the list.")
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
