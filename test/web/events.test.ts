import { afterEach, expect, test } from "bun:test"
import { allCapabilities } from "../../src/spec/index.ts"
import { makeFakeChanges } from "../../src/web/app/middleware/changes.ts"
import { createAppRouter } from "../../src/web/app/router.ts"
import { routes } from "../../src/web/app/routes.ts"
import { makeFakeAssets, makeRuntime } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test("emits valid changed events and unsubscribes when the request aborts", async () => {
  const runtime = makeRuntime()
  const changes = makeFakeChanges()
  const router = createAppRouter({
    runtime,
    capabilities: allCapabilities,
    changes,
    author: "tester",
    hosts: ["localhost"],
    sessionSecret: "test-secret-at-least-32-characters",
    assets: makeFakeAssets(),
  })
  cleanup.push(async () => {
    await router.close()
    await runtime.dispose()
  })
  const abort = new AbortController()
  const response = await router.fetch(
    new Request(`http://localhost${routes.events.href()}`, {
      headers: { Host: "localhost" },
      signal: abort.signal,
    }),
  )
  expect(response.headers.get("content-type")).toContain("text/event-stream")
  expect(changes.listenerCount()).toBe(1)

  changes.emit()
  const chunk = await response.body?.getReader().read()
  expect(new TextDecoder().decode(chunk?.value)).toBe("event: changed\ndata: reload\n\n")

  abort.abort()
  await Promise.resolve()
  expect(changes.listenerCount()).toBe(0)
})
