import { afterEach, expect, test } from "bun:test"
import { makeRouter, seed } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test("emits a changed event naming the project that changed, and unsubscribes on abort", async () => {
  const { router, hubRuntime, project, close } = makeRouter()
  cleanup.push(close)
  const abort = new AbortController()
  const response = await router.fetch(
    new Request("http://localhost/events", { headers: { Host: "localhost" }, signal: abort.signal }),
  )
  expect(response.headers.get("content-type")).toContain("text/event-stream")
  const reader = response.body!.getReader()

  // The SSE handler's hub.changes subscription starts on a forked fiber, so
  // there is a small, unavoidable window where a seed lands before the
  // subscription does (test/hub/helpers.ts's `eventually` exists for the
  // same reason inside the hub's own suite). Retry the seed instead of
  // assuming the first one is observed.
  let text = ""
  for (let attempt = 0; attempt < 25 && text === ""; attempt++) {
    await seed(hubRuntime, project, (todo) => todo.add({ title: `Trigger ${attempt}` }))
    const timedOut = Symbol("timeout")
    const raced = await Promise.race([
      reader.read(),
      new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), 20)),
    ])
    if (raced !== timedOut && !raced.done && raced.value !== undefined) {
      text = new TextDecoder().decode(raced.value)
    }
  }
  expect(text).toMatch(/^event: changed\ndata: \{"project":"[a-z0-9-]+"\}\n\n$/)

  abort.abort()
})
