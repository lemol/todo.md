import { expect, test } from "bun:test"
import { routes } from "../../src/web/app/routes.ts"

test("defines stable hrefs for every web route", () => {
  expect(routes.board.href()).toBe("/")
  expect(routes.events.href()).toBe("/events")
  expect(routes.assets.href({ path: "app/ui/styles.css" })).toBe("/assets/app/ui/styles.css")
  expect(routes.project.board.href({ project: "acme" })).toBe("/p/acme")
  expect(routes.project.done.href({ project: "acme" })).toBe("/p/acme/done")
  expect(routes.project.check.href({ project: "acme" })).toBe("/p/acme/check")
  expect(routes.project.tasks.add.href({ project: "acme" })).toBe("/p/acme/tasks")
  expect(routes.project.tasks.show.href({ project: "acme", id: "007" })).toBe("/p/acme/tasks/007")
  expect(routes.project.tasks.edit.href({ project: "acme", id: "7" })).toBe("/p/acme/tasks/7/edit")
  expect(routes.project.tasks.update.href({ project: "acme", id: "07" })).toBe("/p/acme/tasks/07")
  expect(routes.project.tasks.complete.href({ project: "acme", id: "5" })).toBe(
    "/p/acme/tasks/5/complete",
  )
  expect(routes.project.tasks.reopen.href({ project: "acme", id: "05" })).toBe(
    "/p/acme/tasks/05/reopen",
  )
  expect(routes.project.tasks.comments.href({ project: "acme", id: "9" })).toBe(
    "/p/acme/tasks/9/comments",
  )
  expect(routes.project.tasks.move.href({ project: "acme", id: "9" })).toBe("/p/acme/tasks/9/move")
  expect(routes.project.tasks.confirmRemove.href({ project: "acme", id: "9" })).toBe(
    "/p/acme/tasks/9/remove",
  )
  expect(routes.project.tasks.remove.href({ project: "acme", id: "9" })).toBe(
    "/p/acme/tasks/9/remove",
  )
  expect(routes.project.groups.edit.href({ project: "acme" })).toBe("/p/acme/groups/rename")
  expect(routes.project.groups.rename.href({ project: "acme" })).toBe("/p/acme/groups/rename")
})
