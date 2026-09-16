import { afterEach, expect, test } from "bun:test"
import { makeRouter } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test("makeRouter serves the default project's board", async () => {
  const { router, project, close } = await makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request(`http://localhost/p/${project}`, { headers: { Host: "localhost" } }),
  )
  expect(response.status).toBe(200)
  expect(await response.text()).toContain("Acme")
})

test("makeRouter can reduce a project's capabilities", async () => {
  const { router, project, close } = await makeRouter({
    capabilities: { groups: false, comments: false },
  })
  cleanup.push(close)
  const response = await router.fetch(
    new Request(`http://localhost/p/${project}`, { headers: { Host: "localhost" } }),
  )
  const html = await response.text()
  expect(html).not.toContain('name="newGroup"')
})
