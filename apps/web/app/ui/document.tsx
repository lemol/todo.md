/** @jsxImportSource remix/ui */
import type { ScriptEntry } from "remix/assets"
import type { Handle } from "remix/ui"
import { ImportMap } from "remix/ui/server"
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
  readonly pageTitle?: string
  readonly content: string
  readonly diagnostics?: { readonly error: number; readonly warning: number }
  readonly flash?: { readonly message: string; readonly tone: "info" | "warning" | "error" }
  readonly scriptEntry?: ScriptEntry
}

export function Document(handle: Handle<DocumentOptions>) {
  return () => {
    const options = handle.props
    const errors = options.diagnostics?.error ?? 0
    const warnings = options.diagnostics?.warning ?? 0
    const badge =
      errors > 0 ? (
        <span class="badge error" title={`${errors} errors`}>
          {errors}
        </span>
      ) : warnings > 0 ? (
        <span class="badge warning" title={`${warnings} warnings`}>
          {warnings}
        </span>
      ) : null
    return (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{options.pageTitle ?? options.title}</title>
          <link rel="stylesheet" href={routes.assets.href({ path: "app/ui/styles.css" })} />
          {options.scriptEntry === undefined ? null : (
            <>
              <ImportMap value={options.scriptEntry.importMap} />
              {options.scriptEntry.preloads.map((preload) => (
                <link rel="modulepreload" href={preload} key={preload} />
              ))}
              <script type="module" src={options.scriptEntry.href} />
            </>
          )}
        </head>
        <body>
          <header>
            <a class="list-name" href={routes.board.href()}>
              {options.title}
            </a>
            <nav aria-label="Todo list">
              <a href={routes.board.href()}>Board</a>
              <a href={routes.done.href()}>Done</a>
              <a class="diagnostic-link" href={routes.check.href()}>
                Check {badge}
              </a>
            </nav>
          </header>
          {options.flash === undefined ? null : (
            <div class={`flash ${options.flash.tone}`} role="status">
              {options.flash.message}
            </div>
          )}
          <div class="reload-notice info" data-reload-notice hidden>
            The list changed. <a href={routes.board.href()}>Reload</a>
          </div>
          <main data-live-region innerHTML={options.content} />
        </body>
      </html>
    )
  }
}

export interface ErrorPageOptions {
  readonly status: number
  readonly message: string
  readonly scriptEntry?: ScriptEntry
}

export function ErrorPage(handle: Handle<ErrorPageOptions>) {
  return () => {
    const options = handle.props
    return (
      <Document
        title="todo.md"
        pageTitle={`${options.status} error`}
        content={`<h1>${options.status}</h1><p>${escapeHtml(options.message)}</p><a href="${routes.board.href()}">Back to board</a>`}
        {...(options.scriptEntry === undefined ? {} : { scriptEntry: options.scriptEntry })}
      />
    )
  }
}

export const Page = Document
export const Flash = (message: string) =>
  `<div class="flash info" role="status">${escapeHtml(message)}</div>`
