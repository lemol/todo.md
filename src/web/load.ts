Bun.plugin({
  name: "todo-md-remix-jsx",

  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => ({
      contents: `/** @jsxImportSource remix/component */\n${await Bun.file(path).text()}`,
      loader: "tsx",
    }))
  },
})

export const loadServer = () => import("./server.ts")
