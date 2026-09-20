import { Effect, Option, Path } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { Hub } from "../../hub/index.ts"
import { CliContext, Dir, output, Project } from "../context.ts"
import { UsageError } from "../errors.ts"

const loopback = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "::1"

export const web = Command.make(
  "web",
  {
    port: Flag.integer("port").pipe(
      Flag.withDescription("Port to listen on; the next free port is used when busy"),
      Flag.withDefault(4400),
    ),
    host: Flag.string("host").pipe(
      Flag.withDescription("Host to bind; anyone who can reach it can edit the list"),
      Flag.withDefault("127.0.0.1"),
    ),
  },
  Effect.fn(function* ({ port, host }) {
    const { cwd, env, username, home, userHome } = yield* CliContext
    const dir = yield* Dir
    const project = yield* Project
    if (Option.isSome(dir) && Option.isSome(project)) {
      return yield* Effect.fail(new Error("use --project or --dir, not both"))
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return yield* new UsageError({ message: "port must be an integer from 1 to 65535" })
    }
    const path = yield* Path.Path
    // Fail fast with the CLI's tagged errors; startServer re-resolves the same project.
    const hub = yield* Hub
    yield* hub.resolve({
      ...(Option.isSome(project) ? { project: project.value } : {}),
      ...(Option.isSome(dir) ? { dir: path.resolve(cwd, dir.value) } : {}),
      cwd,
    })
    yield* Effect.scoped(
      Effect.gen(function* () {
        const { startServer } = yield* Effect.promise(() => import("../../web/server.ts"))
        const started = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startServer({
              cwd,
              ...(Option.isSome(dir) ? { dir: path.resolve(cwd, dir.value) } : {}),
              ...(Option.isSome(project) ? { project: project.value } : {}),
              port,
              host,
              env,
              username,
              home,
              userHome,
            }),
          ),
          (handle) => Effect.promise(() => handle.close()),
        )
        const url = `http://${host}:${started.port}/p/${started.project}`
        yield* output(undefined, { url }, () =>
          loopback(host)
            ? [url]
            : [url, "Warning: anyone who can reach this address can edit the list."],
        )
        yield* Effect.never
      }),
    )
  }),
).pipe(
  Command.withDescription("Start the local web UI over the hub"),
  Command.withExamples([
    { command: "todo web --dir todo", description: "Serve the board for ./todo/TODO.md" },
    { command: "todo web --project acme", description: "Serve the registered acme project" },
    { command: "todo web --port 4410", description: "Serve on port 4410" },
  ]),
)
