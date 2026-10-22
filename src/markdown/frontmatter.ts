import { Document, isMap, isScalar, parseDocument } from "yaml"
import { lineAt, textLines } from "./lines.ts"

export interface FrontmatterData {
  readonly data: Readonly<Record<string, unknown>>
  /** Why the YAML could not be read, if it could not. */
  readonly error: string | undefined
}

/** Reads frontmatter YAML (without the `---` fences) into a plain object. */
export const readFrontmatter = (yaml: string): FrontmatterData => {
  const doc = parseDocument(yaml)
  const [first] = doc.errors

  if (first !== undefined) return { data: {}, error: textLines(first.message)[0] }

  const value: unknown = doc.toJS()

  if (value === null || value === undefined) return { data: {}, error: undefined }

  if (typeof value !== "object" || Array.isArray(value)) {
    return { data: {}, error: "frontmatter must be a mapping" }
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
 * The raw YAML is parsed first, so a lone CR that YAML reads as content keeps
 * its line; when the raw text has errors, the YAML is read with lone CRs as
 * line breaks instead, the way the Markdown parser reads them. Last line first.
 */
export const frontmatterEdits = (
  yaml: string,
  fields: Readonly<Record<string, unknown>>,
): FrontmatterEdit[] => {
  const lineCount = yaml === "" ? 0 : textLines(yaml).length
  let text = yaml
  let doc = parseDocument(yaml)
  let current = readFrontmatter(yaml).data
  let map = doc.contents
  let blockMap = isMap(map) && !map.flow

  if (doc.errors.length > 0 || (map !== null && !blockMap)) {
    text = yaml === "" ? "" : textLines(yaml).join("\n")
    doc = parseDocument(text)
    current = readFrontmatter(text).data
    map = doc.contents
    blockMap = isMap(map) && !map.flow

    if (doc.errors.length > 0 || (map !== null && !blockMap)) {
      const merged = { ...current, ...fields }

      return [
        {
          start: 0,
          deleteCount: lineCount,
          lines: formatFrontmatter(
            Object.entries(merged).filter(([, value]) => value !== undefined),
          ),
        },
      ]
    }
  }

  const lineOf = (offset: number) => lineAt(text, offset)

  const edits: FrontmatterEdit[] = []
  const appended: string[] = []

  for (const [key, value] of Object.entries(fields)) {
    if (same(current[key], value)) continue

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

  return edits.sort((a, b) => b.start - a.start)
}
