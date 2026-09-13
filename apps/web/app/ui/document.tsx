import { routes } from "../routes.ts"

export const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

export interface DocumentOptions {
  readonly title: string
  readonly content: string
  readonly diagnostics?: { readonly error: number; readonly warning: number }
  readonly flash?: string
}

export const renderDocument = (options: DocumentOptions): string => {
  const errors = options.diagnostics?.error ?? 0
  const warnings = options.diagnostics?.warning ?? 0
  const badge = errors + warnings > 0 ? ` (${errors} errors, ${warnings} warnings)` : ""
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(options.title)}</title><link rel="stylesheet" href="${routes.assets.href({ path: "app/ui/styles.css" })}"><script type="module" src="${routes.assets.href({ path: "app/actions/public/entry.ts" })}"></script></head><body><header><span>${escapeHtml(options.title)}</span><nav><a href="${routes.board.href()}">Board</a><a href="${routes.done.href()}">Done</a><a href="${routes.check.href()}">Check <span aria-label="diagnostics">${escapeHtml(badge)}</span></a></nav></header>${options.flash === undefined ? "" : `<div role="status">${escapeHtml(options.flash)}</div>`}<main data-live-region>${options.content}</main></body></html>`
}

export const Document = (options: DocumentOptions) => () => renderDocument(options)
export const Page = Document
export const ErrorPage = (status: number, message: string) =>
  renderDocument({
    title: `${status} error`,
    content: `<h1>${status}</h1><p>${escapeHtml(message)}</p><a href="${routes.board.href()}">Back to board</a>`,
  })
export const Flash = (message: string) => `<div role="status">${escapeHtml(message)}</div>`
