import type { TaskId } from "../spec/index.ts"
import { formatId } from "./ids.ts"
import { isBlank } from "./lines.ts"
import { formatMetadataLine, type InlineFields, parseMetadataLine } from "./metadata.ts"
import { linkTarget } from "./paths.ts"

/** Escapes the characters that would end or nest a link's text. */
export const escapeLinkText = (text: string): string => text.replace(/[\\[\]]/g, "\\$&")

/** Removes Markdown backslash escapes. */
export const unescapeLinkText = (text: string): string => text.replace(/\\([!-/:-@[-`{-~])/g, "$1")

/** The head of an item: `<id> - <title>`. */
export const formatHead = (id: TaskId, title: string): string => `${formatId(id)} - ${title}`

/** Splits a head into ID and title; a head without `<digits> - ` has no ID (spec §2.4). */
export const parseHead = (
  head: string,
): { readonly id: string | undefined; readonly title: string } => {
  const match = /^(\d+) - (.*)$/.exec(head)

  return match === null
    ? { id: undefined, title: head.trim() }
    : { id: match[1]?.replace(/^0+(?=\d)/, ""), title: (match[2] ?? "").trim() }
}

const checkbox = (checked: boolean | undefined) => (checked === true ? "[x]" : "[ ]")

export interface InlineItem {
  readonly id: TaskId
  readonly title: string
  readonly checked?: boolean
  readonly fields: InlineFields
  readonly description: string
}

/** The canonical lines of an inline task item (spec §2.4, §2.5). */
export const formatInlineItem = (item: InlineItem): string[] => {
  const metadata = formatMetadataLine(item.fields)
  const description = item.description === "" ? [] : item.description.split("\n")

  // Terminal blank lines fall outside the parsed item and would survive promotion.
  while (description.length > 0 && isBlank(description[description.length - 1])) {
    description.pop()
  }

  const [firstLine] = description
  const separate =
    metadata === "" && firstLine !== undefined && parseMetadataLine(firstLine) !== undefined

  const body = [...(metadata === "" ? [] : [metadata]), ...(separate ? [""] : []), ...description]

  return [
    `- ${checkbox(item.checked)} ${formatHead(item.id, item.title)}`,
    ...body.map((line) => (isBlank(line) ? "" : `  ${line}`)),
  ]
}

export interface LinkedItem {
  readonly id: TaskId
  readonly title: string
  readonly checked?: boolean
  /** Root-relative path of the task file. */
  readonly path: string
}

/** The canonical line of a linked task item. */
export const formatLinkedItem = (item: LinkedItem): string[] => [
  `- ${checkbox(item.checked)} [${escapeLinkText(formatHead(item.id, item.title))}](${linkTarget(item.path)})`,
]
