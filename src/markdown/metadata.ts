import { parse as parseYaml } from "yaml"
import { type Diagnostic, type TaskId, unique } from "../spec/index.ts"
import { parseId } from "./ids.ts"

/** The fields a metadata line can carry (spec §2.5). */
export interface InlineFields {
  readonly tags: ReadonlyArray<string>
  readonly assignee: string | undefined
  readonly dependsOn: ReadonlyArray<TaskId>
  readonly extra: Readonly<Record<string, unknown>>
}

export const noFields: InlineFields = { tags: [], assignee: undefined, dependsOn: [], extra: {} }

export interface ParsedMetadata {
  readonly fields: InlineFields
  /** Problems found in an otherwise valid metadata line; the caller adds the location. */
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

const word = /^[\p{L}\p{N}_\-/.]+$/u
const keyValue = /^([a-z][a-z0-9_]*):([^\s/]\S*)$/
const reserved = new Set(["title", "completed_at", "group", "id", "outcome", "cancelled_reason"])
const standard = new Set(["tags", "assignee", "depends_on"])

const isToken = (token: string): boolean =>
  ((token.startsWith("#") || token.startsWith("@")) && word.test(token.slice(1))) ||
  keyValue.test(token)

/** Reads a `key:value` value as a YAML plain scalar: `3` is a number, `true` a boolean. */
const scalar = (value: string): unknown => {
  if (/^[[{]/.test(value)) return value
  try {
    const parsed: unknown = parseYaml(value)
    return parsed === null || typeof parsed === "object" ? value : parsed
  } catch {
    return value
  }
}

const error = (code: string, message: string): Diagnostic => ({ severity: "error", code, message })

/**
 * Parses a metadata line. Returns `undefined` when the line is description:
 * it is metadata only if every token is `#tag`, `@name` or `key:value`.
 */
export const parseMetadataLine = (line: string): ParsedMetadata | undefined => {
  const tokens = line
    .trim()
    .split(/\s+/)
    .flatMap((chunk) => chunk.split(/,(?=[#@])/))
    .filter((token) => token !== "")
  if (tokens.length === 0 || !tokens.every(isToken)) return undefined

  const tags: string[] = []
  const assignees: string[] = []
  const dependsOn: TaskId[] = []
  const extra: Record<string, unknown> = {}
  const diagnostics: Diagnostic[] = []

  for (const token of tokens) {
    if (token.startsWith("#")) {
      tags.push(token.slice(1))
      continue
    }
    if (token.startsWith("@")) {
      assignees.push(token.slice(1))
      continue
    }
    const [, key = "", value = ""] = keyValue.exec(token) ?? []
    if (reserved.has(key)) {
      diagnostics.push(error("reserved-field", `${key} cannot be set on a metadata line`))
    } else if (key === "tags") {
      tags.push(...value.split(",").filter((tag) => tag !== ""))
    } else if (key === "assignee") {
      assignees.push(value)
    } else if (key === "depends_on") {
      const ids = value.split(",").map(parseId)
      if (ids.every((id) => id !== undefined)) {
        dependsOn.push(...ids)
      } else {
        diagnostics.push(error("invalid-metadata", `depends_on must list task IDs: ${value}`))
      }
    } else {
      extra[key] = scalar(value)
    }
  }
  if (assignees.length > 1) {
    diagnostics.push(error("multiple-assignees", `more than one assignee: ${assignees.join(", ")}`))
  }

  return {
    fields: { tags: unique(tags), assignee: assignees[0], dependsOn: unique(dependsOn), extra },
    diagnostics,
  }
}

/** The single token for an extra value, or `undefined` if it cannot be written inline. */
const token = (value: unknown): string | undefined => {
  const text =
    typeof value === "string"
      ? value
      : (typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean"
        ? String(value)
        : undefined
  if (text === undefined || !/^[^\s/]\S*$/.test(text) || /,[#@]/.test(text)) return undefined
  return scalar(text) === value ? text : undefined
}

/** Whether `fields` can be written as a metadata line; otherwise the task needs a file (spec §2.9). */
export const fitsMetadataLine = (fields: InlineFields): boolean =>
  fields.tags.every((tag) => word.test(tag)) &&
  (fields.assignee === undefined || word.test(fields.assignee)) &&
  Object.entries(fields.extra).every(
    ([key, value]) =>
      /^[a-z][a-z0-9_]*$/.test(key) &&
      !reserved.has(key) &&
      !standard.has(key) &&
      token(value) !== undefined,
  )

/** Formats `fields` as a metadata line (`""` when there is nothing to write). Requires `fitsMetadataLine`. */
export const formatMetadataLine = (fields: InlineFields): string =>
  [
    ...fields.tags.map((tag) => `#${tag}`),
    ...(fields.assignee === undefined ? [] : [`@${fields.assignee}`]),
    ...(fields.dependsOn.length === 0 ? [] : [`depends_on:${fields.dependsOn.join(",")}`]),
    ...Object.entries(fields.extra).map(([key, value]) => `${key}:${token(value)}`),
  ].join(" ")
