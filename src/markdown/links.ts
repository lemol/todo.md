import type { Nodes } from "mdast"
import { parseAst } from "./ast.ts"

/** Where a link, image or definition destination sits in the source, `[from, to)` in UTF-16 offsets. */
export interface MarkdownLinkDestination {
  readonly from: number
  readonly to: number
  /** The destination as the parser reads it (escapes and entities decoded). */
  readonly url: string
}

const unescape = (raw: string) => raw.replace(/\\([!-/:-@[-`{-~])/g, "$1")

/** The offset just past the `]` closing the label that opens at `open`, or `undefined`. */
const labelEnd = (source: string, open: number, limit: number): number | undefined => {
  let depth = 0

  for (let i = open; i < limit; i++) {
    const char = source[i]

    if (char === "\\") {
      i++
    } else if (char === "`") {
      let run = 1

      while (source[i + run] === "`") run++

      const closing = source.indexOf("`".repeat(run), i + run)

      i = closing === -1 ? i + run - 1 : closing + run - 1
    } else if (char === "[") {
      depth++
    } else if (char === "]") {
      depth--

      if (depth === 0) return i + 1
    }
  }

  return undefined
}

const isSpace = (char: string | undefined) =>
  char === " " || char === "\t" || char === "\n" || char === "\r"

/** The destination that starts at `at` (after optional whitespace), or `undefined`. */
const destinationAt = (
  source: string,
  at: number,
  limit: number,
): readonly [number, number] | undefined => {
  let i = at

  while (i < limit && isSpace(source[i])) i++

  if (source[i] === "<") {
    for (let j = i + 1; j < limit; j++) {
      if (source[j] === "\\") j++
      else if (source[j] === ">") return [i + 1, j]
      else if (source[j] === "\n" || source[j] === "<") return undefined
    }

    return undefined
  }

  let depth = 0
  let j = i

  for (; j < limit; j++) {
    const char = source[j]

    if (char === "\\") j++
    else if (char === "(") depth++
    else if (char === ")") {
      if (depth === 0) break

      depth--
    } else if (isSpace(char)) break
  }

  return j > i ? [i, j] : undefined
}

/**
 * The destinations of inline links and images and of reference definitions,
 * in source order. Code, YAML frontmatter and literal text have none. A
 * destination whose raw text the scan cannot match to the parser's reading is
 * left out rather than guessed.
 */
export const markdownLinkDestinations = (
  source: string,
): ReadonlyArray<MarkdownLinkDestination> => {
  const found: MarkdownLinkDestination[] = []

  const walk = (node: Nodes): void => {
    if (node.type === "link" || node.type === "image" || node.type === "definition") {
      const start = node.position?.start.offset
      const end = node.position?.end.offset

      if (start !== undefined && end !== undefined) {
        const open = node.type === "image" ? start + 1 : start
        const closed = source[open] === "[" ? labelEnd(source, open, end) : undefined
        const next = node.type === "definition" ? ":" : "("

        if (closed !== undefined && source[closed] === next) {
          const span = destinationAt(source, closed + 1, end)

          if (span !== undefined && unescape(source.slice(span[0], span[1])) === node.url) {
            found.push({ from: span[0], to: span[1], url: node.url })
          }
        }
      }
    }

    if ("children" in node) node.children.forEach(walk)
  }

  walk(parseAst(source))

  return found.sort((a, b) => a.from - b.from)
}
