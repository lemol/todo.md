import { expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { makeFiles } from "../../src/fs/files.ts"
import { rebaseTaskLinks } from "../../src/fs/links.ts"
import { markdownLinkDestinations } from "../../src/markdown/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "./helpers.ts"

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
