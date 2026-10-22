/**
 * Text as lines, remembering the line ending style and whether the text ended
 * with one, so edits can rewrite only the lines they touch (spec §2.10).
 */
export interface Lines {
  readonly lines: ReadonlyArray<string>
  /** Per line, `"\r"` where a lone CR ended it in the source; `undefined` writes `eol`. */
  readonly breaks: ReadonlyArray<"\r" | undefined>
  readonly eol: "\n" | "\r\n"
  readonly finalNewline: boolean
}

export const splitLines = (text: string): Lines => {
  const crlf = text.match(/\r\n/g)?.length ?? 0
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf
  const eol = crlf > lf ? "\r\n" : "\n"
  const ending = text.match(/(?:\r\n|\n|\r)$/)?.[0]
  const finalNewline = ending !== undefined
  const body = finalNewline ? text.slice(0, -ending.length) : text
  const lines = text === "" ? [] : body.split(/\r\n?|\n/)
  const terminators = body.match(/\r\n?|\n/g) ?? []
  const breaks: Array<"\r" | undefined> = terminators.map((t) => (t === "\r" ? "\r" : undefined))

  if (finalNewline) breaks.push(ending === "\r" ? "\r" : undefined)

  return { lines, breaks, eol, finalNewline }
}

/**
 * Splits text that is about to become lines on every line ending (CRLF, LF or
 * a lone CR), so no `\r` is carried into a file whose lines end another way.
 */
export const textLines = (text: string): string[] => text.split(/\r\n?|\n/)

export const joinLines = ({ lines, breaks, eol, finalNewline }: Lines): string => {
  if (lines.length === 0) return ""

  const joined = lines
    .map((line, index) =>
      index === lines.length - 1 && !finalNewline ? line : line + (breaks[index] ?? eol),
    )
    .join("")

  return joined
}

/**
 * Replaces `deleteCount` lines at `start` with `insert`. Appending at the end
 * of the text also ends it with a newline.
 */
export const spliceLines = (
  text: Lines,
  start: number,
  deleteCount: number,
  insert: ReadonlyArray<string>,
): Lines => {
  const lines = [...text.lines]
  const breaks = [...text.breaks]

  lines.splice(start, deleteCount, ...insert)
  breaks.splice(start, deleteCount, ...insert.map(() => undefined as undefined))
  const appended = insert.length > 0 && start + deleteCount >= text.lines.length

  return { ...text, lines, breaks, finalNewline: text.finalNewline || appended }
}

export const isBlank = (line: string | undefined): boolean =>
  line !== undefined && line.trim() === ""

/** Joins lines into a block of text without leading or trailing blank lines. */
export const trimBlock = (lines: ReadonlyArray<string>): string => {
  let start = 0
  let end = lines.length

  while (start < end && isBlank(lines[start])) start++

  while (end > start && isBlank(lines[end - 1])) end--

  return lines.slice(start, end).join("\n")
}
