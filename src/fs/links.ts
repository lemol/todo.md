import { Effect, Path } from "effect"
import { markdownLinkDestinations } from "../markdown/index.ts"
import type { StoreError } from "../spec/index.ts"
import type { Files } from "./files.ts"

const external = /^([a-zA-Z][a-zA-Z0-9+.-]*:|\/|#|$)/

const decode = (pathname: string): string | undefined => {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return undefined
  }
}

const encode = (pathname: string) =>
  encodeURI(pathname).replaceAll("?", "%3F").replaceAll("#", "%23")

/**
 * Rewrites the relative destinations of a task file's Markdown links so they
 * keep pointing at the same files after the file moves from `from` to `to`
 * (list-root-relative). A destination is rebased only when it resolved to an
 * existing file before the move; URLs, absolute paths, anchors and unresolved
 * links stay as written (spec §2.10). Only the destination text is spliced.
 */
export const rebaseTaskLinks = (
  files: Files,
  from: string,
  to: string,
  source: string,
): Effect.Effect<string, StoreError> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const fromDir = path.dirname(from)
    const toDir = path.dirname(to)

    if (fromDir === toDir) return source

    const oldBase = path.join(files.root, fromDir)
    const newBase = path.join(files.root, toDir)

    let result = source

    for (const { from: start, to: end, url } of markdownLinkDestinations(source)
      .slice()
      .sort((a, b) => b.from - a.from)) {
      if (external.test(url)) continue

      const cut = url.search(/[?#]/)
      const pathname = cut === -1 ? url : url.slice(0, cut)
      const suffix = cut === -1 ? "" : url.slice(cut)
      const decoded = decode(pathname)

      if (pathname === "" || decoded === undefined) continue

      const target = path.join(oldBase, decoded)

      if (!(yield* files.exists(path.relative(files.root, target)))) continue

      let relative = encode(path.relative(newBase, target))

      if (relative === "") relative = "."

      if (pathname.endsWith("/") && !relative.endsWith("/")) relative += "/"

      result = result.slice(0, start) + relative + suffix + result.slice(end)
    }

    return result
  }).pipe(Effect.provide(Path.layer))
