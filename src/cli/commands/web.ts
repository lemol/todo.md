import { Effect, Option, Path } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { findListRoot } from "../../fs/index.ts"
import { startServer } from "../../web/server.ts"
import { CliContext, Dir, output, Project } from "../context.ts"
import { NoListFound, UsageError } from "../errors.ts"

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
    const { cwd, env, username } = yield* CliContext
    const dir = yield* Dir
    const project = yield* Project
    if (Option.isSome(project)) {
      return yield* new UsageError({ message: "todo web works on local lists; use --dir" })
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return yield* new UsageError({ message: "port must be an integer from 1 to 65535" })
    }
    const path = yield* Path.Path
    // Fail fast with the CLI's tagged NoListFound; startServer re-resolves the same root.
    yield* Option.isSome(dir)
      ? Effect.succeed(path.resolve(cwd, dir.value))
      : findListRoot(cwd).pipe(
          Effect.flatMap((found) =>
            Option.isSome(found) ? Effect.succeed(found.value) : new NoListFound({ cwd }),
          ),
        )
    yield* Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startServer({
              cwd,
              ...(Option.isSome(dir) ? { dir: dir.value } : {}),
              port,
              host,
              env,
              username,
            }),
          ),
          (handle) => Effect.promise(() => handle.close()),
        )
        const url = `http://${host}:${started.port}`
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
  Command.withDescription("Start the local web UI over the current list"),
  Command.withExamples([
    { command: "todo web --dir todo", description: "Serve the board for ./todo/TODO.md" },
    { command: "todo web --port 4410", description: "Serve on port 4410" },
  ]),
)
