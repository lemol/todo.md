import type { Heading, Nodes, Root } from "mdast"
import { fromMarkdown } from "mdast-util-from-markdown"
import { frontmatterFromMarkdown } from "mdast-util-frontmatter"
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item"
import { frontmatter } from "micromark-extension-frontmatter"
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item"

/** Parses Markdown (CommonMark + YAML frontmatter + GFM task list items) into an mdast tree. */
export const parseAst = (source: string): Root =>
  fromMarkdown(source, {
    extensions: [frontmatter(["yaml"]), gfmTaskListItem()],
    mdastExtensions: [frontmatterFromMarkdown(["yaml"]), gfmTaskListItemFromMarkdown()],
  })

/** The 0-based line range `[start, end)` a node covers. */
export const lineSpan = (node: Nodes): { readonly start: number; readonly end: number } => ({
  start: (node.position?.start.line ?? 1) - 1,
  end: node.position?.end.line ?? 0,
})

/** A heading's raw text and its 0-based column range on its first line. */
export const headingText = (
  source: string,
  heading: Heading,
): { readonly text: string; readonly from: number; readonly to: number } => {
  const first = heading.children[0]?.position
  const last = heading.children.at(-1)?.position

  if (first === undefined || last === undefined) return { text: "", from: 0, to: 0 }

  const raw = source.slice(first.start.offset, last.end.offset)
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return { text: "", from: first.start.column - 1, to: first.start.column - 1 }
  }

  const leading = raw.length - raw.trimStart().length
  const trailing = raw.length - raw.trimEnd().length
  const from = first.start.column - 1 + leading
  const to = first.start.line === last.end.line ? last.end.column - 1 - trailing : from

  return { text: trimmed, from, to }
}
