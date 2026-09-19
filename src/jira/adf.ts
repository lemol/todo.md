/**
 * Atlassian Document Format → Markdown. Pure, and deliberately without a
 * dependency: ADF is a small tree and only Jira's own nodes appear in issue
 * descriptions and comments.
 */

import { Predicate } from "effect"

/** An ADF node, as far as this module cares. */
interface Node {
  readonly type?: unknown
  readonly text?: unknown
  readonly attrs?: unknown
  readonly marks?: unknown
  readonly content?: unknown
}

const asNode = (value: unknown): Node | undefined =>
  Predicate.isObject(value) ? (value as Node) : undefined

const typeOf = (node: Node): string => (Predicate.isString(node.type) ? node.type : "")

const childrenOf = (node: Node): ReadonlyArray<Node> =>
  Array.isArray(node.content)
    ? node.content.flatMap((child) => {
        const parsed = asNode(child)
        return parsed === undefined ? [] : [parsed]
      })
    : []

const attr = (node: Node, name: string): unknown =>
  Predicate.isObject(node.attrs) ? (node.attrs as Record<string, unknown>)[name] : undefined

const stringAttr = (node: Node, name: string): string | undefined => {
  const value = attr(node, name)
  return Predicate.isString(value) ? value : undefined
}

const marked = (text: string, marks: unknown): string => {
  if (!Array.isArray(marks)) return text
  return marks.reduce<string>((inner, raw) => {
    const mark = asNode(raw)
    if (mark === undefined) return inner
    switch (typeOf(mark)) {
      case "strong":
        return `**${inner}**`
      case "em":
        return `*${inner}*`
      case "code":
        return `\`${inner}\``
      case "strike":
        return `~~${inner}~~`
      case "link": {
        const href = stringAttr(mark, "href")
        return href === undefined ? inner : `[${inner}](${href})`
      }
      default:
        return inner
    }
  }, text)
}

/** A node's inline rendering: the text of one paragraph, heading or table cell. */
const inline = (nodes: ReadonlyArray<Node>): string =>
  nodes
    .map((node) => {
      switch (typeOf(node)) {
        case "text":
          return marked(Predicate.isString(node.text) ? node.text : "", node.marks)
        case "hardBreak":
          return "\n"
        case "mention": {
          const label = stringAttr(node, "text") ?? stringAttr(node, "displayName")
          return label === undefined ? "" : label.startsWith("@") ? label : `@${label}`
        }
        case "emoji":
          return stringAttr(node, "text") ?? stringAttr(node, "shortName") ?? ""
        case "inlineCard":
        case "blockCard": {
          const url = stringAttr(node, "url")
          return url === undefined ? "" : `<${url}>`
        }
        case "media":
          return "[attachment]"
        default:
          return inline(childrenOf(node))
      }
    })
    .join("")

export interface AdfOptions {
  /**
   * Levels added to every heading, capped at 6. Comment bodies use 3, so a
   * quoted heading never competes with the document's own (spec §2.6).
   */
  readonly headingShift?: number
}

/** Renders block nodes, dropping the ones that come out empty. */
const blocks = (nodes: ReadonlyArray<Node>, options: AdfOptions): ReadonlyArray<string> =>
  nodes.map((node) => block(node, options)).filter((text) => text !== "")

/** Prefixes every line, so a quote or a list item survives its own line breaks. */
const indent = (text: string, first: string, rest: string = first): string =>
  text
    .split("\n")
    .map((line, index) => `${index === 0 ? first : rest}${line}`.trimEnd())
    .join("\n")

const listTypes = new Set(["bulletList", "orderedList", "taskList"])

/** A cell on one line: Markdown tables have no room for blocks. */
const cell = (node: Node, options: AdfOptions): string =>
  blocks(childrenOf(node), options)
    .join(" ")
    .replace(/\s*\n\s*/g, " ")
    .replaceAll("|", "\\|")

/**
 * A GFM table. Jira allows a table with no header row, which GFM does not, so
 * that table gets an empty one rather than losing its shape.
 */
const table = (node: Node, options: AdfOptions): string => {
  const rows = childrenOf(node).map((row) =>
    childrenOf(row).map((column) => ({
      header: typeOf(column) === "tableHeader",
      text: cell(column, options),
    })),
  )
  const first = rows[0]
  if (first === undefined) return ""
  const headed = first.every((column) => column.header)
  const header = headed ? first.map((column) => column.text) : first.map(() => "")
  const body = (headed ? rows.slice(1) : rows).map((row) => row.map((column) => column.text))
  const line = (columns: ReadonlyArray<string>) => `| ${columns.join(" | ")} |`
  return [line(header), line(header.map(() => "---")), ...body.map(line)].join("\n")
}

/**
 * One list item's blocks. A nested list hangs straight off its item, while a
 * second paragraph is separated by a blank line, as Markdown readers expect.
 */
const itemBody = (item: Node, options: AdfOptions): string => {
  if (typeOf(item) !== "listItem") return block(item, options)
  return childrenOf(item).reduce((body, child) => {
    const rendered = block(child, options)
    if (rendered === "") return body
    if (body === "") return rendered
    return `${body}${listTypes.has(typeOf(child)) ? "\n" : "\n\n"}${rendered}`
  }, "")
}

const list = (
  node: Node,
  options: AdfOptions,
  marker: (index: number, item: Node) => string,
): string =>
  childrenOf(node)
    .map((item, index) => {
      const bullet = marker(index, item)
      return indent(itemBody(item, options), bullet, " ".repeat(bullet.length))
    })
    .join("\n")

const block = (node: Node, options: AdfOptions): string => {
  switch (typeOf(node)) {
    case "doc":
      return blocks(childrenOf(node), options).join("\n\n")
    case "heading": {
      const level = attr(node, "level")
      const shifted = (Predicate.isNumber(level) ? level : 1) + (options.headingShift ?? 0)
      return `${"#".repeat(Math.min(Math.max(shifted, 1), 6))} ${inline(childrenOf(node))}`
    }
    case "codeBlock":
      return `\`\`\`${stringAttr(node, "language") ?? ""}\n${inline(childrenOf(node))}\n\`\`\``
    case "blockquote":
    case "panel":
      return indent(blocks(childrenOf(node), options).join("\n\n"), "> ")
    case "table":
      return table(node, options)
    // Childless nodes that stand on their own line; `inline` knows them all.
    case "blockCard":
    case "media":
      return inline([node])
    case "rule":
      return "---"
    case "bulletList":
      return list(node, options, () => "- ")
    case "orderedList": {
      const start = attr(node, "order")
      const first = Predicate.isNumber(start) ? start : 1
      return list(node, options, (index) => `${first + index}. `)
    }
    case "taskList":
      return list(node, options, (_index, item) =>
        stringAttr(item, "state") === "DONE" ? "- [x] " : "- [ ] ",
      )
    default:
      return inline(childrenOf(node))
  }
}

/** The document as Markdown, with no trailing newline; an absent document is empty. */
export const adfToMarkdown = (document: unknown, options: AdfOptions = {}): string => {
  const node = asNode(document)
  return node === undefined ? "" : block(node, options)
}
