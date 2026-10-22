import { Result } from "effect"
import { Document, isMap, isScalar, parseDocument } from "yaml"
import { lineAt, textLines } from "./lines.ts"

export interface FrontmatterData {
  readonly data: Readonly<Record<string, unknown>>
  /** Why the YAML could not be read, if it could not. */
  readonly error: string | undefined
  /** The 1-based file line of a YAML syntax error, counting the opening fence; absent otherwise. */
  readonly errorLine?: number
}

/**
 * Parses frontmatter YAML: the raw text first, so a lone CR that YAML reads as
 * content keeps its meaning, and only when that has errors the text with lone
 * CRs as line breaks, the way the Markdown parser reads them. `text` is the
 * text `doc` was parsed from; if both fail, `doc` is the raw parse.
 */
const parseYaml = (yaml: string): { readonly doc: Document.Parsed; readonly text: string } => {
  const raw = parseDocument(yaml)

  if (raw.errors.length === 0) return { doc: raw, text: yaml }

  const text = yaml === "" ? "" : textLines(yaml).join("\n")

  if (text === yaml) return { doc: raw, text: yaml }

  const lines = parseDocument(text)

  return lines.errors.length === 0 ? { doc: lines, text } : { doc: raw, text: yaml }
}

const notMapping = "frontmatter must be a mapping"

/**
 * The 1-based line and column of `offset` in `text`, counting CRLF, LF and
 * a lone CR as line endings, the way `splitLines` does. `yaml` counts lines
 * by LF only, so its `linePos` falls short below a lone CR.
 */
const offsetLineCol = (
  text: string,
  offset: number,
): { readonly line: number; readonly col: number } => {
  let line = 1
  let start = 0

  for (const match of text.matchAll(/\r\n?|\n/g)) {
    const end = (match.index ?? 0) + match[0].length

    if (end > offset) break

    line++

    start = end
  }

  return { line, col: offset - start + 1 }
}

/**
 * Reads frontmatter YAML (without the `---` fences) into a plain object; never
 * throws. YAML that fails to parse or resolve is reported in `error`.
 */
export const readFrontmatter = (yaml: string): FrontmatterData => {
  const { doc, text } = parseYaml(yaml)
  const [first] = doc.errors

  if (first !== undefined) {
    const head = textLines(first.message.replace(/\s*at line \d+, column \d+[\s\S]*$/, ""))[0] ?? ""
    const offset = first.pos?.[0]
    const start = first.linePos?.[0]

    if (offset === undefined) {
      if (start === undefined) return { data: {}, error: head.replace(/:$/, "") }

      // YAML counts from the first line below the opening fence.
      const errorLine = start.line + 1

      return { data: {}, error: `${head} at line ${errorLine}, column ${start.col}`, errorLine }
    }

    const { line, col } = offsetLineCol(text, offset)

    // YAML counts from the first line below the opening fence.
    const errorLine = line + 1

    return { data: {}, error: `${head} at line ${errorLine}, column ${col}`, errorLine }
  }

  let value: unknown

  try {
    value = doc.toJS()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)

    return { data: {}, error: textLines(message)[0] }
  }

  if (value === null || value === undefined) return { data: {}, error: undefined }

  if (typeof value !== "object" || Array.isArray(value)) {
    return { data: {}, error: notMapping }
  }

  return { data: value as Record<string, unknown>, error: undefined }
}

const isScalarList = (value: unknown): value is ReadonlyArray<unknown> =>
  Array.isArray(value) && value.every((item) => item === null || typeof item !== "object")

/** One `key: value` entry as YAML lines; lists of scalars use flow style (`[a, b]`). */
const entry = (key: string, value: unknown): string[] => {
  const doc = new Document({})

  doc.set(key, isScalarList(value) ? doc.createNode(value, { flow: true }) : value)

  return doc.toString({ flowCollectionPadding: false }).replace(/\n$/, "").split("\n")
}

/** Formats fields, in order, as frontmatter lines (without the `---` fences). */
export const formatFrontmatter = (fields: ReadonlyArray<readonly [string, unknown]>): string[] =>
  fields.flatMap(([key, value]) => entry(key, value))

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Replaces `deleteCount` frontmatter lines at `start` (0-based, below the opening fence) with `lines`. */
export interface FrontmatterEdit {
  readonly start: number
  readonly deleteCount: number
  readonly lines: ReadonlyArray<string>
}

/**
 * Edits for top-level keys in frontmatter `yaml`; `undefined` deletes a key.
 * Only the lines of keys whose value changes are rewritten, and new keys are
 * appended, so comments, quoting and key order elsewhere survive (spec §2.10).
 * A block map whose aliases do not resolve is still edited key by key, and
 * its other lines, the bad alias included, stay as written. Any other
 * frontmatter the reader reports an error for (a syntax error, a non-mapping,
 * a flow map with a bad alias) fails with the reader's message instead of
 * dropping the fields or replacing the frontmatter (spec §2.10). Valid
 * frontmatter in flow style, or a null document, is rewritten in block style
 * with every key kept.
 * The raw YAML is parsed first, so a lone CR that YAML reads as content keeps
 * its line; when the raw text has errors, the YAML is read with lone CRs as
 * line breaks instead, the way the Markdown parser reads them. Last line first.
 */
export const frontmatterEdits = (
  yaml: string,
  fields: Readonly<Record<string, unknown>>,
): Result.Result<FrontmatterEdit[], string> => {
  const lineCount = yaml === "" ? 0 : textLines(yaml).length
  const parsed = parseYaml(yaml)
  const { text, doc } = parsed
  const { data: current, error } = readFrontmatter(yaml)
  const unresolved = doc.errors.length === 0 && error !== undefined && error !== notMapping
  const map = doc.contents

  if (error !== undefined && !(unresolved && isMap(map) && !map.flow)) {
    return Result.fail(error)
  }

  if (doc.errors.length > 0 || (map !== null && !(isMap(map) && !map.flow))) {
    const merged = { ...current, ...fields }

    return Result.succeed([
      {
        start: 0,
        deleteCount: lineCount,
        lines: formatFrontmatter(Object.entries(merged).filter(([, value]) => value !== undefined)),
      },
    ])
  }

  const lineOf = (offset: number) => lineAt(text, offset)

  const edits: FrontmatterEdit[] = []
  const appended: string[] = []

  for (const [key, value] of Object.entries(fields)) {
    if (!unresolved && same(current[key], value)) continue

    const pair =
      isMap(map) && !map.flow
        ? map.items.find((item) => isScalar(item.key) && item.key.value === key)
        : undefined

    const keyRange = pair !== undefined && isScalar(pair.key) ? pair.key.range : undefined

    if (keyRange == null) {
      if (value !== undefined) appended.push(...entry(key, value))

      continue
    }

    const valueRange = (pair?.value as { range?: [number, number, number] } | null)?.range
    const end = Math.max((valueRange ?? keyRange)[1] - 1, keyRange[0])
    const start = lineOf(keyRange[0])

    edits.push({
      start,
      deleteCount: lineOf(end) - start + 1,
      lines: value === undefined ? [] : entry(key, value),
    })
  }

  if (appended.length > 0) edits.push({ start: lineCount, deleteCount: 0, lines: appended })

  return Result.succeed(edits.sort((a, b) => b.start - a.start))
}
