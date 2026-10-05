import type { Heading, ListItem } from "mdast"
import type { Diagnostic, TaskId } from "../spec/index.ts"
import { headingText, lineSpan, parseAst } from "./ast.ts"
import { readFrontmatter } from "./frontmatter.ts"
import { parseId } from "./ids.ts"
import { escapeLinkText, formatHead, parseHead, unescapeLinkText } from "./items.ts"
import { isBlank, joinLines, type Lines, spliceLines, splitLines, trimBlock } from "./lines.ts"
import { type InlineFields, noFields, parseMetadataLine } from "./metadata.ts"
import { basename, groupSlug, normalizePath, resolveLink } from "./paths.ts"

/** List configuration from `TODO.md` frontmatter (spec §2.2). Paths are relative to the list root. */
export interface ListConfig {
  readonly tasksDir: string
  readonly doneDir: string
}

export const defaultConfig: ListConfig = { tasksDir: ".", doneDir: "done" }

export interface TodoItem {
  /** 0-based line range `[start, end)` of the item and its body. */
  readonly start: number
  readonly end: number
  /** `undefined` until normalization assigns one (spec §2.4). */
  readonly id: TaskId | undefined
  readonly checked: boolean
  readonly title: string
  readonly linked: boolean
  /** Linked items: the task file's root-relative path, `undefined` if the link leaves the root. */
  readonly path: string | undefined
  /** Inline items: the metadata line's fields. */
  readonly fields: InlineFields
  /** Inline items: the description, de-indented. */
  readonly description: string
  /** Column where the head (`<id> - <title>` or the link) starts on the first line. */
  readonly headColumn: number
  /** Linked items: the column range of the link text on the first line. */
  readonly linkText: readonly [number, number] | undefined
}

export interface TodoSection {
  /** `undefined` for the ungrouped section, which is always first. */
  readonly name: string | undefined
  readonly description: string
  /** Groups: the heading's 0-based line and the column range of its name. */
  readonly heading:
    | { readonly line: number; readonly from: number; readonly to: number }
    | undefined
  /** 0-based line range `[start, end)` of the section. */
  readonly start: number
  readonly end: number
  readonly items: ReadonlyArray<TodoItem>
}

/** A parsed `TODO.md` (spec §2.3). */
export interface TodoFile {
  readonly text: Lines
  readonly config: ListConfig
  readonly title: string
  readonly description: string
  /** The ungrouped section first, then one per group, in document order. */
  readonly sections: ReadonlyArray<TodoSection>
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

const file = "TODO.md"

/** Columns of content inside a list item: the bullet, then 1–4 spaces (CommonMark). */
const contentIndent = (line: string): number => {
  const match = /^(\s*)[-*+]( +)/.exec(line)

  if (match === null) return 0

  const spaces = match[2]?.length ?? 1

  return (match[1]?.length ?? 0) + 1 + (spaces > 4 ? 1 : spaces)
}

const dedent = (line: string, columns: number): string =>
  line.slice(Math.min(columns, line.length - line.trimStart().length))

const readConfig = (yaml: string, diagnostics: Diagnostic[]): ListConfig => {
  const { data, error } = readFrontmatter(yaml)

  const report = (message: string) =>
    diagnostics.push({ severity: "error", code: "invalid-frontmatter", message, file, line: 1 })

  if (error !== undefined) report(error)

  const dir = (key: string, fallback: string): string => {
    const value = data[key]

    if (value === undefined) return fallback

    const path = typeof value === "string" ? normalizePath(value) : undefined

    if (path === undefined) {
      report(`${key} must be a path inside the list root`)

      return fallback
    }

    return path === "" ? "." : path
  }

  return {
    tasksDir: dir("tasks_dir", defaultConfig.tasksDir),
    doneDir: dir("done_dir", defaultConfig.doneDir),
  }
}

/** Parses `TODO.md`. Never fails: problems become diagnostics. */
export const parseTodoFile = (source: string): TodoFile => {
  const text = splitLines(source)
  const tree = parseAst(source)
  const diagnostics: Diagnostic[] = []
  let config = defaultConfig
  let title = ""
  let ungroupedStart = 0
  const ungrouped: TodoItem[] = []
  const groups: Array<{
    name: string
    heading: NonNullable<TodoSection["heading"]>
    items: TodoItem[]
  }> = []

  const parseItem = (node: ListItem): TodoItem | undefined => {
    const { start, end } = lineSpan(node)
    const first = text.lines[start] ?? ""
    const prefix = /^\s*[-*+]\s+\[[ xX]\]\s*/.exec(first)

    if (node.checked == null || prefix === null) return undefined

    const headColumn = prefix[0].length
    const head = first.slice(headColumn).trimEnd()

    if (head === "") return undefined

    const indent = contentIndent(first)
    const body = text.lines.slice(start + 1, end).map((line) => dedent(line, indent))
    const location = { file, line: start + 1 }
    const paragraph = node.children[0]
    const link = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined
    const linkPosition = link?.position
    const isLink =
      link?.type === "link" &&
      linkPosition !== undefined &&
      linkPosition.start.line === start + 1 &&
      linkPosition.end.line === start + 1 &&
      linkPosition.start.column - 1 === headColumn &&
      first.slice(linkPosition.end.column - 1).trim() === ""

    let item: TodoItem

    if (isLink && link?.type === "link") {
      const from = (link.children[0]?.position?.start.column ?? headColumn + 2) - 1
      const to = (link.children.at(-1)?.position?.end.column ?? headColumn + 2) - 1
      const { id, title } = parseHead(unescapeLinkText(first.slice(from, to)))
      const path = resolveLink(link.url)

      if (path === undefined) {
        diagnostics.push({
          severity: "error",
          code: "outside-root",
          message: `link leaves the list root: ${link.url}`,
          ...location,
        })
      } else {
        const prefixId = /^(\d+)-/.exec(basename(path))?.[1]

        if (id !== undefined && prefixId !== undefined && parseId(prefixId) !== id) {
          diagnostics.push({
            severity: "warning",
            code: "id-mismatch",
            message: `task ${id} links to ${path}`,
            taskId: id,
            ...location,
          })
        }
      }

      if (body.some((line) => !isBlank(line))) {
        diagnostics.push({
          severity: "warning",
          code: "linked-body",
          message: "a linked item's body is ignored; move it to the task file",
          ...location,
        })
      }

      item = {
        start,
        end,
        id,
        checked: node.checked,
        title,
        linked: true,
        path,
        fields: noFields,
        description: "",
        headColumn,
        linkText: [from, to],
      }
    } else {
      const { id, title } = parseHead(head)
      const [firstBody] = body
      const metadata =
        firstBody === undefined || isBlank(firstBody) ? undefined : parseMetadataLine(firstBody)

      for (const diagnostic of metadata?.diagnostics ?? []) {
        diagnostics.push({
          ...diagnostic,
          ...(id === undefined ? {} : { taskId: id }),
          file,
          line: start + 2,
        })
      }

      const description = trimBlock(metadata === undefined ? body : body.slice(1))
      item = {
        start,
        end,
        id,
        checked: node.checked,
        title,
        linked: false,
        path: undefined,
        fields: metadata?.fields ?? noFields,
        description,
        headColumn,
        linkText: undefined,
      }
    }

    if (item.id === undefined) {
      diagnostics.push({
        severity: "info",
        code: "missing-id",
        message: `"${item.title}" needs an ID`,
        ...location,
      })
    }

    if (item.checked) {
      diagnostics.push({
        severity: "info",
        code: "checked-item",
        message: `"${item.title}" is checked and will move to done`,
        ...(item.id === undefined ? {} : { taskId: item.id }),
        ...location,
      })
    }

    return item
  }

  for (const node of tree.children) {
    const { start, end } = lineSpan(node)

    if (node.type === "yaml") {
      config = readConfig(node.value, diagnostics)
      ungroupedStart = end
    } else if (node.type === "heading" && node.depth === 1 && title === "" && groups.length === 0) {
      title = headingText(source, node).text
      ungroupedStart = end
    } else if (
      node.type === "heading" &&
      node.depth === 2 &&
      headingText(source, node).text !== ""
    ) {
      const { text: name, from, to } = headingText(source, node as Heading)
      const duplicate = groups.find(
        (group) => group.name === name || groupSlug(group.name) === groupSlug(name),
      )

      if (duplicate !== undefined) {
        diagnostics.push({
          severity: "error",
          code: "duplicate-group",
          message: `group "${name}" duplicates "${duplicate.name}"`,
          file,
          line: start + 1,
        })
      }

      groups.push({ name, heading: { line: start, from, to }, items: [] })
    } else if (node.type === "list") {
      for (const child of node.children) {
        const item = parseItem(child)

        if (item !== undefined) (groups.at(-1)?.items ?? ungrouped).push(item)
      }
    }
  }

  const describe = (from: number, items: ReadonlyArray<TodoItem>, end: number) =>
    trimBlock(text.lines.slice(from, items[0]?.start ?? end))

  const ungroupedEnd = groups[0]?.heading.line ?? text.lines.length
  const sections: TodoSection[] = [
    {
      name: undefined,
      description: describe(ungroupedStart, ungrouped, ungroupedEnd),
      heading: undefined,
      start: ungroupedStart,
      end: ungroupedEnd,
      items: ungrouped,
    },
    ...groups.map((group, index) => {
      const end = groups[index + 1]?.heading.line ?? text.lines.length

      return {
        name: group.name,
        description: describe(group.heading.line + 1, group.items, end),
        heading: group.heading,
        start: group.heading.line,
        end,
        items: group.items,
      }
    }),
  ]

  return { text, config, title, description: sections[0]?.description ?? "", sections, diagnostics }
}

/** Every item, in document order. */
export const allItems = (todo: TodoFile): ReadonlyArray<TodoItem> =>
  todo.sections.flatMap((section) => section.items)

export const findItem = (todo: TodoFile, id: TaskId): TodoItem | undefined =>
  allItems(todo).find((item) => item.id === id)

/** The section an item belongs to. */
export const sectionOf = (todo: TodoFile, item: TodoItem): TodoSection | undefined =>
  todo.sections.find((section) => section.items.includes(item))

const lastContentLine = (lines: ReadonlyArray<string>, before: number): number => {
  let line = before - 1

  while (line >= 0 && isBlank(lines[line])) line--

  return line
}

/**
 * Inserts an item's lines as the `index`-th task of `group` (spec §2.10, add).
 * A missing group is appended as a `##` heading at the end of the file.
 */
export const insertItem = (
  todo: TodoFile,
  group: string | undefined,
  index: number,
  item: ReadonlyArray<string>,
): string => {
  const { lines } = todo.text
  const section = todo.sections.find((candidate) => candidate.name === group)

  if (section === undefined) {
    const last = lastContentLine(lines, lines.length)
    const insert = [...(last >= 0 ? [""] : []), `## ${group}`, "", ...item]

    return joinLines(spliceLines(todo.text, last + 1, lines.length - last - 1, insert))
  }

  if (section.items.length === 0) {
    const at = lastContentLine(lines, section.end) + 1
    const before = at > 0 ? [""] : []
    const after = at < lines.length && !isBlank(lines[at]) ? [""] : []

    return joinLines(spliceLines(todo.text, at, 0, [...before, ...item, ...after]))
  }

  const target = section.items[Math.max(0, index)]
  const at = target?.start ?? section.items.at(-1)?.end ?? section.end

  return joinLines(spliceLines(todo.text, at, 0, item))
}

/** Removes an item and its body, without leaving a doubled blank line behind. */
export const removeItem = (todo: TodoFile, item: TodoItem): string => {
  let text = spliceLines(todo.text, item.start, item.end - item.start, [])
  const at = item.start
  const blankBefore = at > 0 && isBlank(text.lines[at - 1])

  if (blankBefore && isBlank(text.lines[at])) text = spliceLines(text, at, 1, [])
  else if (blankBefore && at === text.lines.length) text = spliceLines(text, at - 1, 1, [])

  return joinLines(text)
}

/** Replaces an item and its body with new lines. */
export const replaceItem = (todo: TodoFile, item: TodoItem, lines: ReadonlyArray<string>): string =>
  joinLines(spliceLines(todo.text, item.start, item.end - item.start, lines))

/** Rewrites only an item's head (`<id> - <title>`), keeping its bullet, checkbox and link target. */
export const withHead = (text: Lines, item: TodoItem, id: TaskId, title: string): Lines => {
  const line = text.lines[item.start] ?? ""
  const head = formatHead(id, title)
  const rewritten =
    item.linkText === undefined
      ? line.slice(0, item.headColumn) + head
      : line.slice(0, item.linkText[0]) + escapeLinkText(head) + line.slice(item.linkText[1])

  return spliceLines(text, item.start, 1, [rewritten])
}

export const setItemHead = (todo: TodoFile, item: TodoItem, id: TaskId, title: string): string =>
  joinLines(withHead(todo.text, item, id, title))

/** Renames a group's heading in place (spec §2.10, renameGroup). */
export const renameSection = (todo: TodoFile, from: string, to: string): string => {
  const heading = todo.sections.find((section) => section.name === from)?.heading

  if (heading === undefined) return joinLines(todo.text)

  const line = todo.text.lines[heading.line] ?? ""

  return joinLines(
    spliceLines(todo.text, heading.line, 1, [
      line.slice(0, heading.from) + to + line.slice(heading.to),
    ]),
  )
}

/** A new `TODO.md` with a title and optional description. */
export const formatTodoFile = (options: {
  readonly title: string
  readonly description?: string
}): string => `# ${options.title}\n${options.description ? `\n${options.description}\n` : ""}`
