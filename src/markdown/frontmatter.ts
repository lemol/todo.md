import { Document, isMap, isScalar, parseDocument } from "yaml"

export interface FrontmatterData {
  readonly data: Readonly<Record<string, unknown>>
  /** Why the YAML could not be read, if it could not. */
  readonly error: string | undefined
}

/** Reads frontmatter YAML (without the `---` fences) into a plain object. */
export const readFrontmatter = (yaml: string): FrontmatterData => {
  const doc = parseDocument(yaml)
  const [first] = doc.errors

  if (first !== undefined) return { data: {}, error: first.message.split("\n")[0] }

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

/**
 * Sets top-level keys in frontmatter `yaml`; `undefined` deletes a key. Only
 * the lines of keys whose value changes are rewritten, and new keys are
 * appended, so comments and formatting elsewhere survive (spec §2.10).
 * Returns the new frontmatter lines.
 */
export const setFrontmatterFields = (
  yaml: string,
  fields: Readonly<Record<string, unknown>>,
): string[] => {
  const lines = yaml === "" ? [] : yaml.split("\n")
  const doc = parseDocument(yaml)
  const current = readFrontmatter(yaml).data
  const map = doc.contents
  const blockMap = isMap(map) && !map.flow

  if (doc.errors.length > 0 || (map !== null && !blockMap)) {
    const merged = { ...current, ...fields }

    return formatFrontmatter(Object.entries(merged).filter(([, value]) => value !== undefined))
  }

  const lineOf = (offset: number) => yaml.slice(0, offset).split("\n").length - 1

  const edits: Array<{ start: number; end: number; lines: string[] }> = []
  const appended: string[] = []

  for (const [key, value] of Object.entries(fields)) {
    if (same(current[key], value)) continue

    const pair = blockMap
      ? map.items.find((item) => isScalar(item.key) && item.key.value === key)
      : undefined

    const keyRange = pair !== undefined && isScalar(pair.key) ? pair.key.range : undefined

    if (keyRange == null) {
      if (value !== undefined) appended.push(...entry(key, value))

      continue
    }

    const valueRange = (pair?.value as { range?: [number, number, number] } | null)?.range
    const end = Math.max((valueRange ?? keyRange)[1] - 1, keyRange[0])

    edits.push({
      start: lineOf(keyRange[0]),
      end: lineOf(end),
      lines: value === undefined ? [] : entry(key, value),
    })
  }

  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    lines.splice(edit.start, edit.end - edit.start + 1, ...edit.lines)
  }

  return [...lines, ...appended]
}
