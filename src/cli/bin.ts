#!/usr/bin/env bun
import { homedir, userInfo } from "node:os"
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { fsSource } from "../hub/index.ts"
import { main } from "./main.ts"

const userHome = homedir()

main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  username: userInfo().username,
  color: process.stdout.isTTY === true && process.env.NO_COLOR === undefined,
  home: process.env.TODO_MD_HOME ?? `${userHome}/.todo-md`,
  userHome,
  sources: [fsSource],
}).pipe(
  Effect.tap((code) =>
    Effect.sync(() => {
      process.exitCode = code
    }),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
)
