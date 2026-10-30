import { expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import type { Nodes } from "mdast"
import { makeFiles } from "../../src/fs/files.ts"
import { rebaseTaskLinks } from "../../src/fs/links.ts"
import { parseAst } from "../../src/markdown/ast.ts"
import { markdownLinkDestinations } from "../../src/markdown/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, filesOnDisk, md } from "./helpers.ts"

test("destination spans exclude syntax, titles, code and YAML", () => {
  const source = md(
    "---",
    'custom: "[yaml](../skip.md)"',
    "---",
    '[Project](../README.md "Title")',
    "![Image](<../my%20notes.md>)",
    "[Nested](../a(b).md)",
    "[Ref][p]",
    "",
    '[p]: ../ref.md#intro "Reference"',
    "`[code](../skip.md)`",
    "```md",
    "[fenced](../skip.md)",
    "```",
  ).replaceAll("\n", "\r\n")

  const destinations = markdownLinkDestinations(source)
  const expected = ["../README.md", "../my%20notes.md", "../a(b).md", "../ref.md#intro"]

  expect(destinations.map(({ from, to }) => source.slice(from, to))).toEqual(expected)
  expect(destinations.map(({ url }) => url)).toEqual(expected)
})

const parsedUrls = (source: string): string[] => {
  const urls: string[] = []

  const walk = (node: Nodes): void => {
    if (node.type === "link" || node.type === "image" || node.type === "definition") {
      urls.push(node.url)
    }

    if ("children" in node) node.children.forEach(walk)
  }

  walk(parseAst(source))

  return urls
}

for (const [destination, target] of [
  ["../a\\)b.md", "a)b.md"],
  ["../a\\(b.md", "a(b.md"],
  ["../a%26copy%3Bb.md", "a&copy;b.md"],
  ["../a&amp;b.md", "a&b.md"],
  ["../a&#38;b.md", "a&b.md"],
  ["../a&#x26;b.md", "a&b.md"],
  ["../a&amp;>b.md", "a&>b.md"],
  ["../a&amp;<b.md", "a&<b.md"],
  ["../a&amp;\\>b.md", "a&>b.md"],
] as const) {
  for (const syntax of ["link", "image", "definition"] as const) {
    const source =
      syntax === "definition"
        ? `[ref]: ${destination}\n`
        : `${syntax === "image" ? "!" : ""}[x](${destination})\n`

    effectTest(
      `rebased ${syntax} retains decoded target ${target} from ${destination} in both directions`,
      Effect.gen(function* () {
        const disk = yield* Disk
        const files = yield* makeFiles(disk.root).pipe(Effect.provide(BunServices.layer))

        expect(parsedUrls(source).map(decodeURIComponent)).toEqual([`../${target}`])

        const archived = yield* rebaseTaskLinks(
          files,
          "group/task.md",
          "done/group/task.md",
          source,
        )

        const archivedUrls = parsedUrls(archived)

        expect(archivedUrls.map(decodeURIComponent)).toEqual([`../../${target}`])
        expect(yield* disk.exists(`done/group/${decodeURIComponent(archivedUrls[0]!)}`)).toBe(true)

        const reopened = yield* rebaseTaskLinks(
          files,
          "done/group/task.md",
          "group/task.md",
          archived,
        )

        const reopenedUrls = parsedUrls(reopened)

        const seededReopen = yield* rebaseTaskLinks(
          files,
          "done/group/task.md",
          "group/task.md",
          source.replaceAll("../", "../../"),
        )

        expect(parsedUrls(seededReopen).map(decodeURIComponent)).toEqual([`../${target}`])
        expect(reopenedUrls.map(decodeURIComponent)).toEqual([`../${target}`])
        expect(yield* disk.exists(`group/${decodeURIComponent(reopenedUrls[0]!)}`)).toBe(true)
      }),
      diskWith({ [target]: "target", "group/.keep": "", "done/group/.keep": "" }),
    )
  }
}

for (const syntax of ["link", "image", "definition"] as const) {
  const destination = "../ok.md?x=1&amp;copy;=2#end\\)"
  const source =
    syntax === "definition"
      ? `[ref]: ${destination}\n`
      : `${syntax === "image" ? "!" : ""}[x](${destination})\n`

  effectTest(
    `rebased ${syntax} retains Markdown-significant query and fragment`,
    Effect.gen(function* () {
      const disk = yield* Disk
      const files = yield* makeFiles(disk.root).pipe(Effect.provide(BunServices.layer))

      expect(parsedUrls(source)).toEqual(["../ok.md?x=1&copy;=2#end)"])

      const archived = yield* rebaseTaskLinks(files, "group/task.md", "done/group/task.md", source)

      expect(parsedUrls(archived)).toEqual(["../../ok.md?x=1&copy;=2#end)"])
      expect(
        parsedUrls(yield* rebaseTaskLinks(files, "done/group/task.md", "group/task.md", archived)),
      ).toEqual(["../ok.md?x=1&copy;=2#end)"])
    }),
    diskWith({ "ok.md": "target", "group/.keep": "", "done/group/.keep": "" }),
  )
}

for (const [written, archivedInner, target] of [
  ["../a+b.md", "../../a+b.md", "a+b.md"],
  ["../über.md", "../../über.md", "über.md"],
  ["<../My Notes.md>", "<../../My Notes.md>", "My Notes.md"],
  ["../a,b@c.md", "../../a,b@c.md", "a,b@c.md"],
] as const) {
  for (const syntax of ["link", "image", "definition"] as const) {
    const source =
      syntax === "definition"
        ? `[ref]: ${written}\n`
        : `${syntax === "image" ? "!" : ""}[x](${written})\n`

    const expectedArchived =
      syntax === "definition"
        ? `[ref]: ${archivedInner}\n`
        : `${syntax === "image" ? "!" : ""}[x](${archivedInner})\n`

    effectTest(
      `rebased ${syntax} preserves spelling ${written} byte-for-byte`,
      Effect.gen(function* () {
        const disk = yield* Disk
        const files = yield* makeFiles(disk.root).pipe(Effect.provide(BunServices.layer))
        const archived = yield* rebaseTaskLinks(
          files,
          "group/task.md",
          "done/group/task.md",
          source,
        )

        expect(archived).toBe(expectedArchived)
        expect(yield* rebaseTaskLinks(files, "done/group/task.md", "group/task.md", archived)).toBe(
          source,
        )
      }),
      diskWith({ [target]: "target", "group/.keep": "", "done/group/.keep": "" }),
    )
  }
}

for (const [written, archivedPath, reopened] of [
  ["sib.md", "../../group/sib.md", "sib.md"],
  ["./sib.md", "../../group/sib.md", "sib.md"],
  ["sub/x.md", "../../group/sub/x.md", "sub/x.md"],
  ["a&amp;b.md", "../../group/a&amp;b.md", "a&amp;b.md"],
  ["sib.md#h", "../../group/sib.md#h", "sib.md#h"],
  ["../group/sib.md", "../../group/sib.md", "sib.md"],
] as const) {
  for (const syntax of ["link", "image", "definition"] as const) {
    const render = (destination: string) =>
      syntax === "definition"
        ? `[ref]: ${destination}\n`
        : `${syntax === "image" ? "!" : ""}[x](${destination})\n`

    effectTest(
      `rebased ${syntax} normalizes ${written} on reopen`,
      Effect.gen(function* () {
        const disk = yield* Disk
        const files = yield* makeFiles(disk.root).pipe(Effect.provide(BunServices.layer))
        const archived = yield* rebaseTaskLinks(
          files,
          "group/task.md",
          "done/group/task.md",
          render(written),
        )

        expect(archived).toBe(render(archivedPath))
        expect(
          yield* rebaseTaskLinks(
            files,
            "done/group/task.md",
            "group/task.md",
            archived,
            undefined,
            true,
          ),
        ).toBe(render(reopened))
      }),
      diskWith({
        "group/sib.md": "target",
        "group/sub/x.md": "target",
        "group/a&b.md": "target",
        "done/group/.keep": "",
      }),
    )
  }
}

for (const source of [
  "[a`b](../ok.md)\n\n`later`\n",
  "[a``b](../ok.md)\n\n```later```\n",
  "[a`x``]y`](../ok.md)\n",
  "[a`x```]y`](../ok.md)\n",
  "[a``x```]y``](../ok.md)\n",
]) {
  effectTest(
    `rebases links with exact backtick runs bounded to their node: ${JSON.stringify(source)}`,
    Effect.gen(function* () {
      const disk = yield* Disk
      const files = yield* makeFiles(disk.root).pipe(Effect.provide(BunServices.layer))

      expect(parsedUrls(source)).toEqual(["../ok.md"])

      const archived = yield* rebaseTaskLinks(files, "group/task.md", "done/group/task.md", source)

      expect(archived).toBe(source.replace("../ok.md", "../../ok.md"))
      expect(parsedUrls(archived)).toEqual(["../../ok.md"])
      expect(yield* rebaseTaskLinks(files, "done/group/task.md", "group/task.md", archived)).toBe(
        source,
      )
    }),
    diskWith({ "ok.md": "target", "group/.keep": "", "done/group/.keep": "" }),
  )
}

effectTest(
  "rebases outside-list targets and uses the actual destination directory",
  Effect.gen(function* () {
    const disk = yield* Disk
    const files = yield* makeFiles(`${disk.root}/todo`).pipe(Effect.provide(BunServices.layer))
    const source = "[Project](../../product/README.md#intro)\r\n[Missing](../../missing.md)\r\n"
    const archived =
      "[Project](../../../product/README.md#intro)\r\n[Missing](../../missing.md)\r\n"

    expect(
      yield* rebaseTaskLinks(files, "backend/02-links.md", "done/backend/02-links.md", source),
    ).toBe(archived)
    expect(
      yield* rebaseTaskLinks(files, "done/backend/02-links.md", "backend/02-links.md", archived),
    ).toBe(source)
    expect(yield* rebaseTaskLinks(files, "done/backend/02-links.md", "02-links.md", archived)).toBe(
      "[Project](../product/README.md#intro)\r\n[Missing](../../missing.md)\r\n",
    )
    expect(
      yield* rebaseTaskLinks(files, "backend/02-links.md", "backend/03-links.md", source),
    ).toBe(source)
  }),
  diskWith({ "product/README.md": "# intro\n", "todo/.keep": "" }),
)

effectTest(
  "keeps links to the moved file itself and to targets that move with it",
  Effect.gen(function* () {
    const files = yield* filesOnDisk
    const source = "[Self](./02-links.md)\n[Other](./03-other.md)\n[Note](./sib.md)\n"

    const relocate = (path: string) =>
      path === "backend/03-other.md" ? "server/03-other.md" : path

    expect(yield* rebaseTaskLinks(files, "backend/02-links.md", "server/02-links.md", source)).toBe(
      "[Self](./02-links.md)\n[Other](../backend/03-other.md)\n[Note](../backend/sib.md)\n",
    )
    expect(
      yield* rebaseTaskLinks(files, "backend/02-links.md", "server/02-links.md", source, relocate),
    ).toBe("[Self](./02-links.md)\n[Other](./03-other.md)\n[Note](../backend/sib.md)\n")
  }),
  diskWith({ "backend/02-links.md": "", "backend/03-other.md": "", "backend/sib.md": "" }),
)
