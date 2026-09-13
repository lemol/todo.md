import { createController } from "remix/router"
import { routes } from "../../routes.ts"

export default createController(routes.tasks, {
  actions: {
    add: () => new Response("Not Implemented", { status: 501 }),
    show: () => new Response("Not Implemented", { status: 501 }),
    edit: () => new Response("Not Implemented", { status: 501 }),
    update: () => new Response("Not Implemented", { status: 501 }),
    complete: () => new Response("Not Implemented", { status: 501 }),
    reopen: () => new Response("Not Implemented", { status: 501 }),
    comments: () => new Response("Not Implemented", { status: 501 }),
  },
})
