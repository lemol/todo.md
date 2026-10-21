Bun.plugin({
  name: "todo-md-remix-jsx",

  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => ({
      // No newline after the pragma: it must not shift the source's line numbers.
      contents: `/** @jsxImportSource remix/component */ ${await Bun.file(path).text()}`,
      loader: "tsx",
    }))
  },
})

export const loadServer = () => import("./server.ts")
