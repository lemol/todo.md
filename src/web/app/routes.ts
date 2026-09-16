import { get, post, route } from "remix/routes"

export const routes = route({
  board: get("/"),
  events: get("/events"),
  assets: get("/assets/*path"),
  project: route("/p/:project", {
    board: get("/"),
    done: get("/done"),
    check: get("/check"),
    tasks: route("/tasks", {
      add: post(""),
      show: get(":id"),
      edit: get(":id/edit"),
      update: post(":id"),
      complete: post(":id/complete"),
      reopen: post(":id/reopen"),
      comments: post(":id/comments"),
      move: post(":id/move"),
      confirmRemove: get(":id/remove"),
      remove: post(":id/remove"),
    }),
    groups: route("/groups", {
      edit: get("rename"),
      rename: post("rename"),
    }),
  }),
})
