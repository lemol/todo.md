import { get, post, route } from "remix/routes"

export const routes = route({
  dashboard: get("/"),
  events: get("/events"),
  assets: get("/assets/*path"),
  /** The header switcher posts here as a GET form, then redirects to the project's board. */
  go: get("/go"),
  sync: post("/sync"),
  projects: route("/projects", {
    index: get(""),
    add: post(""),
    rename: post(":name/rename"),
    remove: post(":name/remove"),
  }),
  project: route("/p/:project", {
    board: get("/"),
    done: get("/done"),
    check: get("/check"),
    sync: post("/sync"),
    tasks: route("/tasks", {
      add: post(""),
      show: get(":id"),
      edit: get(":id/edit"),
      update: post(":id"),
      complete: post(":id/complete"),
      cancel: post(":id/cancel"),
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
