import { get, post, route } from "remix/routes"

export const routes = route({
  board: get("/"),
  done: get("/done"),
  check: get("/check"),
  events: get("/events"),
  assets: get("/assets/*path"),
  tasks: route("/tasks", {
    add: post(""),
    show: get(":id"),
    edit: get(":id/edit"),
    update: post(":id"),
    complete: post(":id/complete"),
    reopen: post(":id/reopen"),
    comments: post(":id/comments"),
  }),
})
