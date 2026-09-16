import { afterEach, expect, test } from "bun:test"
import { Effect, Queue } from "effect"
import { makeWatchers } from "../hub/helpers.ts"
import { makeRouter } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test("emits a changed event for the source change and unsubscribes on abort", async () => {
  const watchers = await Effect.runPromise(makeWatchers)
  const harness = makeRouter({ changes: watchers.changes })
  const { hubRuntime } = harness
  cleanup.push(async () => {
    await harness.close()
  })
  const abort = new AbortController()
  const response = await harness.router.fetch(
    new Request("http://localhost/events", {
      headers: { Host: "localhost" },
      signal: abort.signal,
    }),
  )
  expect(response.headers.get("content-type")).toContain("text/event-stream")
  const body = response.body
  expect(body).not.toBeNull()
  if (body === null) throw new Error("expected SSE response body")
  const reader = body.getReader()

  await hubRuntime.runPromise(Queue.take(watchers.started))
  await hubRuntime.runPromise(watchers.emit("acme"))
  const event = await reader.read()
  expect(event.done).toBe(false)
  expect(new TextDecoder().decode(event.value)).toBe('event: changed\ndata: {"project":"acme"}\n\n')

  abort.abort()
  await hubRuntime.runPromise(Queue.take(watchers.stopped))
})
