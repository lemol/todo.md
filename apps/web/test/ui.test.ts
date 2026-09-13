import { expect, test } from "bun:test"
import { routes } from "../app/routes.ts"
import { markdownHtml } from "../app/ui/markdown.tsx"
import { makeRouter } from "./harness.ts"

test("renders Markdown without raw HTML", () => {
  const html = markdownHtml("**safe** <script>alert(1)</script>")
  expect(html).toContain("<strong>safe</strong>")
  expect(html).not.toContain("<script>")
  expect(html).not.toContain("alert(1)")
})

test("renders the shared document shell", async () => {
  const response = await makeRouter().fetch(
    new Request(`http://localhost${routes.board.href()}`, {
      headers: { Host: "localhost" },
    }),
  )
  const html = await response.text()
  expect(html).toContain("<!doctype html>")
  expect(html).toContain('<html lang="en">')
  expect(html).toContain('name="viewport"')
  expect(html).toContain(routes.assets.href({ path: "app/ui/styles.css" }))
  expect(html).toContain("Acme")
  expect(html).toContain("Board")
  expect(html).toContain("Done")
  expect(html).toContain("Check")
  expect(html).toContain("data-live-region")
  expect(html).toContain("diagnostic")
})
