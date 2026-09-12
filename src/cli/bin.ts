#!/usr/bin/env bun
import { userInfo } from "node:os"
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { main } from "./main.ts"

main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  username: userInfo().username,
  color: process.stdout.isTTY === true && process.env.NO_COLOR === undefined,
}).pipe(
  Effect.tap((code) =>
    Effect.sync(() => {
      process.exitCode = code
    }),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
)
