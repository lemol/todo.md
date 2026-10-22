import { DateTime, Option } from "effect"
import { type Comment, type Diagnostic, type TaskId, unique } from "../spec/index.ts"
import { headingText, lineSpan, parseAst } from "./ast.ts"
import { formatFrontmatter, frontmatterEdits, readFrontmatter } from "./frontmatter.ts"
import { parseDependencyId } from "./ids.ts"
import {
  isBlank,
  joinLines,
  type Lines,
  spliceLines,
  splitLines,
  textLines,
  trimBlock,
} from "./lines.ts"

/** What a task file holds (spec §2.6). */
export interface TaskFileContent {
  readonly title: string
  readonly tags: ReadonlyArray<string>
  readonly assignee: string | undefined
  readonly dependsOn: ReadonlyArray<TaskId>
  readonly extra: Readonly<Record<string, unknown>>
  readonly description: string
  /** Newest first. */
  readonly comments: ReadonlyArray<Comment>
  /** Done files only. */
  readonly group: string | undefined
  readonly completedAt: DateTime.Utc | undefined
  /** Done files only. Absent means `completed` (spec §1.1). */
  readonly outcome: "completed" | "cancelled" | undefined
  /** Cancelled files only. */
  readonly cancelledReason: string | undefined
}

/** A parsed task file. `title` is `undefined` when the frontmatter has none. */
export interface TaskFile extends Omit<TaskFileContent, "title"> {
  readonly title: string | undefined
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

const standardKeys = new Set([
  "title",
  "tags",
  "assignee",
  "depends_on",
  "completed_at",
  "group",
  "outcome",
  "cancelled_reason",
])

/** `2026-09-12T10:31:00Z`: the frontmatter form of an instant. */
export const formatInstant = (at: DateTime.Utc): string =>
  DateTime.formatIso(at).replace(/\.\d{3}Z$/, "Z")

/** `2026-09-12 10:31 +00:00` (seconds only when not zero): the comment heading form. */
export const formatTimestamp = (at: DateTime.Utc): string => {
  const iso = DateTime.formatIso(at)
  const seconds = iso.slice(17, 19)

  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}${seconds === "00" ? "" : `:${seconds}`} +00:00`
}

const commentHeading =
  /^@(\S+) at (\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\s*(Z|[+-]\d{2}:\d{2}))?$/

/** Reads a comment heading's `@author at <timestamp>` (spec §2.6). */
export const parseCommentHeading = (
  text: string,
): { readonly author: string; readonly at: DateTime.Utc } | undefined => {
  const [, author, date, time, offset] = commentHeading.exec(text) ?? []

  if (author === undefined || date === undefined || time === undefined) return undefined

  const seconds = time.length === 5 ? ":00" : ""
  const at = DateTime.make(`${date}T${time}${seconds}${offset ?? "Z"}`)

  return Option.isSome(at) ? { author, at: DateTime.toUtc(at.value) } : undefined
}

/** Where a task file's parts are, for parsing and editing. */
const layout = (source: string) => {
  const text = splitLines(source)
  const tree = parseAst(source)
  const yaml = tree.children[0]?.type === "yaml" ? tree.children[0] : undefined
  const bodyStart = yaml === undefined ? 0 : lineSpan(yaml).end
  const lastSection = tree.children
    .filter((node) => node.type === "heading" && node.depth === 2)
    .at(-1)

  const comments =
    lastSection?.type === "heading" && headingText(source, lastSection).text === "Comments"
      ? lineSpan(lastSection).start
      : undefined

  return { text, tree, yaml, bodyStart, comments }
}

/**
 * The version of `parseTaskFile`'s output. Parses are cached by content, so
 * bump this whenever the same text would parse to something different.
 */
export const taskFileParserVersion = 4

/** Parses a task file. `file` (its root-relative path) locates diagnostics. Never fails. */
export const parseTaskFile = (source: string, file: string): TaskFile => {
  const { text, tree, yaml, bodyStart, comments: commentsLine } = layout(source)
  const diagnostics: Diagnostic[] = []

  const report = (code: string, message: string, line: number) =>
    diagnostics.push({ severity: "error", code, message, file, line })

  const { data, error } = readFrontmatter(yaml?.value ?? "")

  if (error !== undefined) report("invalid-frontmatter", error, 1)

  const invalid = (key: string, expected: string) =>
    report("invalid-frontmatter", `${key} must be ${expected}`, 1)

  const stringField = (key: string): string | undefined => {
    const value = data[key]

    if (value === undefined || value === null) return undefined

    if (typeof value === "string" && value.trim() !== "") return value

    invalid(key, "a non-empty string")

    return undefined
  }

  const list = <A>(key: string, expected: string, read: (value: unknown) => A | undefined): A[] => {
    const value = data[key]

    if (value === undefined || value === null) return []

    const values = (Array.isArray(value) ? value : [value]).map(read)

    if (values.every((item) => item !== undefined)) return unique(values) as A[]

    invalid(key, expected)

    return []
  }

  const tags = list("tags", "a list of strings", (value) =>
    typeof value === "string" && value.trim() !== "" ? value : undefined,
  )

  const dependsOn = list("depends_on", "a list of task IDs", (value) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : typeof value === "string"
        ? parseDependencyId(value)
        : undefined,
  )

  const completedText = stringField("completed_at")
  const completedAt =
    completedText === undefined ? undefined : Option.getOrUndefined(DateTime.make(completedText))

  if (completedText !== undefined && completedAt === undefined) {
    invalid("completed_at", "an ISO 8601 timestamp")
  }

  const outcomeText = stringField("outcome")
  const outcome =
    outcomeText === "completed" || outcomeText === "cancelled" ? outcomeText : undefined

  if (outcomeText !== undefined && outcome === undefined) {
    invalid("outcome", "`completed` or `cancelled`")
  }

  const cancelledReasonText = stringField("cancelled_reason")

  if (cancelledReasonText !== undefined && outcome !== "cancelled") {
    invalid("cancelled_reason", "absent unless outcome is `cancelled`")
  }

  const comments: Comment[] = []

  if (commentsLine !== undefined) {
    const headings = tree.children.filter(
      (node) => node.type === "heading" && node.depth === 3 && lineSpan(node).start > commentsLine,
    )

    headings.forEach((heading, index) => {
      if (heading.type !== "heading") return

      const { start, end } = lineSpan(heading)
      const next = headings[index + 1]
      const parsed = parseCommentHeading(headingText(source, heading).text)

      if (parsed === undefined) {
        report(
          "invalid-comment",
          "a comment heading must read `@<author> at <YYYY-MM-DD HH:mm>`",
          start + 1,
        )

        return
      }

      const body = trimBlock(
        text.lines.slice(end, next === undefined ? text.lines.length : lineSpan(next).start),
      )

      comments.push({ author: parsed.author, at: DateTime.toUtc(parsed.at), body })
    })
  }

  return {
    title: stringField("title"),
    tags,
    assignee: stringField("assignee"),
    dependsOn,
    extra: Object.fromEntries(Object.entries(data).filter(([key]) => !standardKeys.has(key))),
    description: trimBlock(text.lines.slice(bodyStart, commentsLine ?? text.lines.length)),
    comments,
    group: stringField("group"),
    completedAt: completedAt === undefined ? undefined : DateTime.toUtc(completedAt),
    outcome,
    cancelledReason: outcome === "cancelled" ? cancelledReasonText : undefined,
    diagnostics,
  }
}

const commentLines = (comment: Comment): string[] => [
  `### @${comment.author} at ${formatTimestamp(comment.at)}`,
  "",
  ...textLines(comment.body),
]

/** The frontmatter entries of `content`, in canonical order (spec §2.6). */
const toYamlId = (id: TaskId): number | string => (/^\d+$/.test(id) ? Number(id) : id)
const entries = (content: Partial<TaskFileContent>): Array<readonly [string, unknown]> => [
  ...(content.title === undefined ? [] : [["title", content.title] as const]),
  ...(content.tags === undefined || content.tags.length === 0
    ? []
    : [["tags", [...content.tags]] as const]),
  ...(content.assignee === undefined ? [] : [["assignee", content.assignee] as const]),
  ...(content.dependsOn === undefined || content.dependsOn.length === 0
    ? []
    : [["depends_on", content.dependsOn.map(toYamlId)] as const]),
  ...Object.entries(content.extra ?? {}).filter(([key]) => !standardKeys.has(key)),
  ...(content.group === undefined ? [] : [["group", content.group] as const]),
  ...(content.completedAt === undefined
    ? []
    : [["completed_at", formatInstant(content.completedAt)] as const]),
  ...(content.outcome === undefined ? [] : [["outcome", content.outcome] as const]),
  ...(content.cancelledReason === undefined
    ? []
    : [["cancelled_reason", content.cancelledReason] as const]),
]

/** A new task file for `content` (spec §2.6). */
export const formatTaskFile = (content: TaskFileContent): string => {
  const blocks = [
    ...(content.description === "" ? [] : [textLines(content.description)]),
    ...(content.comments.length === 0
      ? []
      : [
          ["## Comments", ...content.comments.flatMap((comment) => ["", ...commentLines(comment)])],
        ]),
  ]

  const body = blocks.flatMap((block, index) => (index === 0 ? block : ["", ...block]))

  return `${["---", ...formatFrontmatter(entries(content)), "---", ...body].join("\n")}\n`
}

/**
 * Changes to a task file. Absent fields are unchanged; `null` removes
 * `assignee`, `group` or `completed_at`.
 */
export interface TaskFileChanges {
  readonly title?: string
  readonly tags?: ReadonlyArray<string>
  readonly assignee?: string | null
  readonly dependsOn?: ReadonlyArray<TaskId>
  readonly extra?: Readonly<Record<string, unknown>>
  readonly description?: string
  readonly group?: string | null
  readonly completedAt?: DateTime.Utc | null
  readonly outcome?: "completed" | "cancelled" | null
  readonly cancelledReason?: string | null
}

/** Applies `changes`, rewriting only the frontmatter keys and description that change (spec §2.10). */
export const updateTaskFile = (source: string, changes: TaskFileChanges): string => {
  const current = parseTaskFile(source, "")
  const { yaml, bodyStart, comments } = layout(source)
  let text: Lines = splitLines(source)

  if (changes.description !== undefined && changes.description !== current.description) {
    const end = comments ?? text.lines.length
    const block = changes.description === "" ? [] : textLines(changes.description)
    const lines = comments !== undefined && block.length > 0 ? [...block, ""] : block

    text = spliceLines(text, bodyStart, end - bodyStart, lines)
  }

  const fields: Record<string, unknown> = {}

  if (changes.title !== undefined) fields.title = changes.title

  if (changes.tags !== undefined) {
    fields.tags = changes.tags.length === 0 ? undefined : [...changes.tags]
  }

  if (changes.assignee !== undefined) fields.assignee = changes.assignee ?? undefined

  if (changes.dependsOn !== undefined) {
    fields.depends_on = changes.dependsOn.length === 0 ? undefined : changes.dependsOn.map(toYamlId)
  }

  if (changes.extra !== undefined) {
    for (const key of Object.keys(current.extra)) fields[key] = undefined

    Object.assign(fields, changes.extra)
  }

  if (changes.group !== undefined) fields.group = changes.group ?? undefined

  if (changes.completedAt !== undefined) {
    fields.completed_at =
      changes.completedAt === null ? undefined : formatInstant(changes.completedAt)
  }

  if (changes.outcome !== undefined) {
    fields.outcome = changes.outcome === null ? undefined : changes.outcome
  }

  if (changes.cancelledReason !== undefined) {
    fields.cancelled_reason = changes.cancelledReason === null ? undefined : changes.cancelledReason
  }

  if (Object.keys(fields).length > 0) {
    if (yaml !== undefined) {
      for (const edit of frontmatterEdits(yaml.value, fields)) {
        text = spliceLines(text, 1 + edit.start, edit.deleteCount, edit.lines)
      }
    } else {
      const added = Object.entries(fields).filter(([, value]) => value !== undefined)

      if (added.length > 0) {
        text = spliceLines(text, 0, 0, ["---", ...formatFrontmatter(added), "---"])
      }
    }
  }

  return joinLines(text)
}

/** Adds a comment at the top of the comments section, creating the section if needed (spec §2.10). */
export const prependComment = (source: string, comment: Comment): string => {
  const { text, comments } = layout(source)
  const entry = commentLines(comment)

  if (comments !== undefined) {
    const next = text.lines[comments + 1]
    const after = next !== undefined && !isBlank(next) ? [""] : []

    return joinLines(spliceLines(text, comments + 1, 0, ["", ...entry, ...after]))
  }

  let last = text.lines.length - 1

  while (last >= 0 && isBlank(text.lines[last])) last--

  const insert = [...(last >= 0 ? [""] : []), "## Comments", "", ...entry]

  return joinLines(spliceLines(text, last + 1, text.lines.length - last - 1, insert))
}

/**
 * Returns true if the markdown contains unescaped level-1 to level-3 headings
 * (spec §2.6, §2.10). The body is parsed after a blank line, as the reader
 * sees it: a leading `---` fence is a thematic break there, not frontmatter.
 */
export const hasUnescapedHeading = (body: string): boolean =>
  parseAst(`\n${body}`).children.some((node) => node.type === "heading" && node.depth <= 3)
