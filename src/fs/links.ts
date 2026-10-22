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

const encodeAll = (pathname: string) =>
  pathname
    .split("/")
    .map((part) => encodeURIComponent(part).replaceAll("(", "%28").replaceAll(")", "%29"))
    .join("/")

const plainSafe = /^[A-Za-z0-9\-_.,~+@:$!';=*\u0080-\uFFFF]+$/

const angleSafe = /^[A-Za-z0-9\-_.,~+@:$!';=* \u0080-\uFFFF]+$/

const encodeFresh = (segment: string, isAngle: boolean): string => {
  if (segment === "" || segment === "." || segment === "..") return segment

  if ((isAngle ? angleSafe : plainSafe).test(segment)) return segment

  const encoded = encodeURIComponent(segment).replaceAll("(", "%28").replaceAll(")", "%29")

  return isAngle ? encoded.replaceAll("%20", " ") : encoded
}

/**
 * Rewrites the relative destinations of a task file's Markdown links so they
 * keep pointing at the same files after the file moves from `from` to `to`
 * (list-root-relative). A destination is rebased only when it resolved to an
 * existing file before the move; URLs, absolute paths, anchors and unresolved
 * links stay as written (spec §2.10). Only the destination text is spliced.
 *
 * A link to the moved file itself follows it, and `relocate` maps any other
 * target's list-root-relative path before the operation to its path after it,
 * for targets that move with the file (a renamed group directory).
 */
export const rebaseTaskLinks = Effect.fnUntraced(function* (
  files: Files,
  from: string,
  to: string,
  source: string,
  relocate: (path: string) => string = (path) => path,
): Effect.fn.Return<string, StoreError, Path.Path> {
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

    const rawFull = result.slice(start, end)
    const cut = url.search(/[?#]/)
    const rawCut = rawFull.search(/[?#]/)

    const pathname = cut === -1 ? url : url.slice(0, cut)

    const decoded = decode(pathname)

    if (pathname === "" || decoded === undefined) continue

    const before = path.relative(files.root, path.join(oldBase, decoded))

    if (!(yield* files.exists(before))) continue

    const target = path.join(files.root, before === from ? to : relocate(before))

    const fallbackSuffix =
      cut === -1
        ? ""
        : url
            .slice(cut)
            .replace(/([\\()[\]<>])/g, "\\$1")
            .replaceAll("&", "&amp;")

    const legacy = (): string => {
      let relative = encodeAll(path.relative(newBase, target))

      if (relative === "") relative = "."

      if (pathname.endsWith("/") && !relative.endsWith("/")) relative += "/"

      return relative + fallbackSuffix
    }

    if ((cut === -1) !== (rawCut === -1)) {
      result = result.slice(0, start) + legacy() + result.slice(end)

      continue
    }

    const rawPath = rawCut === -1 ? rawFull : rawFull.slice(0, rawCut)
    const rawSuffix = rawCut === -1 ? "" : rawFull.slice(rawCut)
    const urlSegs = pathname.split("/")
    const rawSegs = rawPath.split("/")

    if (urlSegs.length !== rawSegs.length) {
      result = result.slice(0, start) + legacy() + result.slice(end)

      continue
    }

    const oldFs: string[] = []

    let bad = false

    for (const seg of urlSegs) {
      const d = decode(seg)

      if (d === undefined) {
        bad = true

        break
      }

      oldFs.push(d)
    }

    if (bad) {
      result = result.slice(0, start) + legacy() + result.slice(end)

      continue
    }

    let newDecoded = path.relative(newBase, target)

    if (newDecoded === "") newDecoded = "."

    const newFs = newDecoded.split("/")
    const isAngle = result[start - 1] === "<" && result[end] === ">"

    let keep = 0

    const maxKeep = Math.min(oldFs.length, newFs.length)

    for (let k = maxKeep; k > 0; k--) {
      let ok = true

      for (let i = 0; i < k; i++) {
        if (oldFs[oldFs.length - k + i] !== newFs[newFs.length - k + i]) {
          ok = false

          break
        }
      }

      if (ok) {
        keep = k

        break
      }
    }

    const fresh = newFs.slice(0, newFs.length - keep).map((seg) => encodeFresh(seg, isAngle))
    const kept = rawSegs.slice(rawSegs.length - keep)

    let newPath = [...fresh, ...kept].join("/")

    if (newPath === "") newPath = "."

    if (rawPath.endsWith("/") && !newPath.endsWith("/")) newPath += "/"

    if (newPath !== "." && newFs[0] !== "." && newFs[0] !== "..") newPath = `./${newPath}`

    result = result.slice(0, start) + newPath + rawSuffix + result.slice(end)
  }

  return result
}, Effect.provide(Path.layer))
