import { afterEach, expect, test } from "bun:test"
import { makeRouter } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test("allowed GET requests reach the board controller", async () => {
  const { router, project, close } = makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request(`http://localhost/p/${project}`, { headers: { Host: "localhost" } }),
  )
  expect(response.status).toBe(200)
  expect(await response.text()).toContain("Acme")
})

test("GET / redirects to the startup project's board", async () => {
  const { router, project, close } = makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request("http://localhost/", { headers: { Host: "localhost" }, redirect: "manual" }),
  )
  expect(response.status).toBe(302)
  expect(response.headers.get("location")).toBe(`/p/${project}`)
})

test("an unknown project renders 404", async () => {
  const { router, close } = makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request("http://localhost/p/ghost", { headers: { Host: "localhost" } }),
  )
  expect(response.status).toBe(404)
})
