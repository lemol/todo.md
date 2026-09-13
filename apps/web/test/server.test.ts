import { expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { helpText, installSignalHandlers, parseServerOptions } from "../server.ts"

test("parses server defaults and options", () => {
  const options = parseServerOptions(["--dir", "todo", "--port", "4401", "--host", "0.0.0.0"], {
    cwd: "/tmp",
    username: "tester",
    env: {},
  })
  expect(options).toMatchObject({ cwd: "/tmp", dir: "todo", port: 4401, host: "0.0.0.0" })
  expect(parseServerOptions(["--help"])).toEqual({ help: true })
  expect(helpText).toContain("--dir")
  expect(() => parseServerOptions(["--port", "nope"])).toThrow()
})

test("a termination signal closes once and removes both handlers", async () => {
  const signals = new EventEmitter()
  let closes = 0
  installSignalHandlers(async () => {
    closes += 1
  }, signals)

  expect(signals.listenerCount("SIGINT")).toBe(1)
  expect(signals.listenerCount("SIGTERM")).toBe(1)
  signals.emit("SIGINT")
  await Promise.resolve()
  expect(closes).toBe(1)
  expect(signals.listenerCount("SIGINT")).toBe(0)
  expect(signals.listenerCount("SIGTERM")).toBe(0)
  signals.emit("SIGTERM")
  expect(closes).toBe(1)
})
