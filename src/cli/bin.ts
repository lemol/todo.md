#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { homedir, userInfo } from "node:os"
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { GitSource } from "../git/index.ts"
import { fsSource } from "../hub/index.ts"
import { JiraSource } from "../jira/index.ts"
import { main } from "./main.ts"

const userHome = homedir()

// A task description arrives on stdin when a flag is given `-`, read whole so
// the shell never sees it. A tty means nothing was piped; a read failure reads
// as nothing. Deferred: only a `-` evaluates it, so a pipe that stays open
// never holds up a command that does not ask for one.
const readStdin = (): string => {
  try {
    return process.stdin.isTTY === true ? "" : readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

Effect.all([
  GitSource.make({ env: process.env }),
  JiraSource.make({ env: process.env }).pipe(Effect.provide(FetchHttpClient.layer)),
])
  .pipe(
    Effect.flatMap(([gitSource, jiraSource]) =>
      main(process.argv.slice(2), {
        cwd: process.cwd(),
        env: process.env,
        username: userInfo().username,
        color: process.stdout.isTTY === true && process.env.NO_COLOR === undefined,
        home: process.env.TODO_MD_HOME ?? `${userHome}/.todo-md`,
        userHome,
        sources: [fsSource, gitSource, jiraSource],
        stdin: Effect.sync(readStdin),
      }),
    ),
  )
  .pipe(
    Effect.tap((code) =>
      Effect.sync(() => {
        process.exitCode = code
      }),
    ),
    Effect.provide(BunServices.layer),
    BunRuntime.runMain,
  )
