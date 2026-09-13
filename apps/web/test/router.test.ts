import { expect, test } from "bun:test"
import { routes } from "../app/routes.ts"
import { makeRouter } from "./harness.ts"

test("allowed GET requests reach the board controller", async () => {
  const router = makeRouter()
  const response = await router.fetch(new Request(`http://localhost${routes.board.href()}`, {
    headers: { Host: "localhost" },
  }))

  expect(response.status).toBe(200)
  expect(await response.text()).toContain("Acme")
})
