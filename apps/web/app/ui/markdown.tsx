import { toHtml } from "hast-util-to-html"
import { fromMarkdown } from "mdast-util-from-markdown"
import { toHast } from "mdast-util-to-hast"

export const markdownHtml = (source: string): string => {
  const withoutRawHtml = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "")
  return toHtml(toHast(fromMarkdown(withoutRawHtml)) as Parameters<typeof toHtml>[0])
}

export function Markdown({ source }: { readonly source: string }) {
  return () => `<div class="markdown">${markdownHtml(source)}</div>`
}
