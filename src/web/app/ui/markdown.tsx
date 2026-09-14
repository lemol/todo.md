import { toHtml } from "hast-util-to-html"
import { fromMarkdown } from "mdast-util-from-markdown"
import { toHast } from "mdast-util-to-hast"

export const markdownHtml = (source: string): string => {
  const withoutRawHtml = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "")
  const tree = toHast(fromMarkdown(withoutRawHtml)) as Parameters<typeof toHtml>[0]
  const sanitizeLinks = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return
    const record = node as Record<string, unknown>
    const properties = record.properties
    if (typeof properties === "object" && properties !== null) {
      const values = properties as Record<string, unknown>
      const href = values.href
      if (typeof href === "string" && !/^(?:https?:|mailto:|\/|#|\.\.?\/)/i.test(href))
        delete values.href
    }
    if (Array.isArray(record.children)) for (const child of record.children) sanitizeLinks(child)
  }
  sanitizeLinks(tree)
  return toHtml(tree)
}

export function Markdown({ source }: { readonly source: string }) {
  return () => `<div class="markdown">${markdownHtml(source)}</div>`
}
