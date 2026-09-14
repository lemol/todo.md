import { expect, test } from "bun:test"
import { routes } from "../../src/web/app/routes.ts"

test("defines stable hrefs for every web route", () => {
  expect(routes.board.href()).toBe("/")
  expect(routes.done.href()).toBe("/done")
  expect(routes.check.href()).toBe("/check")
  expect(routes.events.href()).toBe("/events")
  expect(routes.assets.href({ path: "app/ui/styles.css" })).toBe("/assets/app/ui/styles.css")
  expect(routes.tasks.add.href()).toBe("/tasks")
  expect(routes.tasks.show.href({ id: "007" })).toBe("/tasks/007")
  expect(routes.tasks.edit.href({ id: "7" })).toBe("/tasks/7/edit")
  expect(routes.tasks.update.href({ id: "07" })).toBe("/tasks/07")
  expect(routes.tasks.complete.href({ id: "5" })).toBe("/tasks/5/complete")
  expect(routes.tasks.reopen.href({ id: "05" })).toBe("/tasks/05/reopen")
  expect(routes.tasks.comments.href({ id: "9" })).toBe("/tasks/9/comments")
})
