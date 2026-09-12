/**
 * Text as lines, remembering the line ending style and whether the text ended
 * with one, so edits can rewrite only the lines they touch (spec §2.10).
 */
export interface Lines {
  readonly lines: ReadonlyArray<string>
  readonly eol: "\n" | "\r\n"
  readonly finalNewline: boolean
}

export const splitLines = (text: string): Lines => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const finalNewline = text.endsWith("\n")
  const body = finalNewline ? text.slice(0, text.endsWith("\r\n") ? -2 : -1) : text
  return { lines: text === "" ? [] : body.split(/\r?\n/), eol, finalNewline }
}

export const joinLines = ({ lines, eol, finalNewline }: Lines): string =>
  lines.length === 0 ? "" : lines.join(eol) + (finalNewline ? eol : "")

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
  lines.splice(start, deleteCount, ...insert)
  const appended = insert.length > 0 && start + deleteCount >= text.lines.length
  return { ...text, lines, finalNewline: text.finalNewline || appended }
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
