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

export interface SwitcherProject {
  readonly name: string
  readonly registered: boolean
}

export interface DocumentOptions {
  readonly title: string
  readonly pageTitle?: string
  readonly content: string
  /** The project this page belongs to; omitted only for a page with no project (e.g. an unknown-project 404). */
  readonly project?: string
  readonly diagnostics?: { readonly error: number; readonly warning: number }
  readonly flash?: { readonly message: string; readonly tone: "info" | "warning" | "error" }
  readonly scriptEntry?: ScriptEntry
  /** Every project, for the header switcher; omitted hides it (e.g. an error page). */
  readonly switcher?: ReadonlyArray<SwitcherProject>
  /**
   * The hub event kinds this page's live region listens to. Omitted means
   * "this page's project's own `changed` and `synced`", which is `data-project`.
   */
  readonly liveEvents?: ReadonlyArray<string>
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
    const project = options.project
    const boardHref = project === undefined ? "/" : routes.project.board.href({ project })
    const switcher =
      options.switcher === undefined || options.switcher.length === 0 ? null : (
        <form class="switcher" method="get" action={routes.go.href()}>
          <label class="visually-hidden" for="switch-project">
            Project
          </label>
          <select id="switch-project" name="project" data-submit-on-change>
            {options.switcher.map((entry) => (
              <option
                value={entry.name}
                key={entry.name}
                {...(entry.name === project ? { selected: true } : {})}
              >
                {entry.registered ? entry.name : `${entry.name} (not registered)`}
              </option>
            ))}
          </select>
          <button class="secondary" type="submit">
            Go
          </button>
        </form>
      )
    const nav = (
      <nav aria-label="Projects">
        <a href={routes.dashboard.href()}>Dashboard</a>
        <a href={routes.projects.index.href()}>Projects</a>
        {project === undefined ? null : (
          <>
            <a href={boardHref}>Board</a>
            <a href={routes.project.done.href({ project })}>Done</a>
            <a class="diagnostic-link" href={routes.project.check.href({ project })}>
              Check {badge}
            </a>
          </>
        )}
      </nav>
    )
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
            <a class="list-name" href={boardHref}>
              {options.title}
            </a>
            {project === undefined ? null : <span class="project-badge">{project}</span>}
            {switcher}
            {nav}
          </header>
          {options.flash === undefined ? null : (
            <div class={`flash ${options.flash.tone}`} role="status">
              {options.flash.message}
            </div>
          )}
          <div class="reload-notice info" data-reload-notice hidden>
            The list changed. <a href={boardHref}>Reload</a>
          </div>
          <main
            data-live-region
            {...(project === undefined ? {} : { "data-project": project })}
            {...(options.liveEvents === undefined
              ? {}
              : { "data-live-events": options.liveEvents.join(" ") })}
            innerHTML={options.content}
          />
        </body>
      </html>
    )
  }
}

export interface ErrorPageOptions {
  readonly status: number
  readonly message: string
  readonly project?: string
  readonly scriptEntry?: ScriptEntry
}

export function ErrorPage(handle: Handle<ErrorPageOptions>) {
  return () => {
    const options = handle.props
    const back =
      options.project === undefined ? "/" : routes.project.board.href({ project: options.project })
    return (
      <Document
        title="todo.md"
        pageTitle={`${options.status} error`}
        content={`<h1>${options.status}</h1><p>${escapeHtml(options.message)}</p><a href="${back}">Back to board</a>`}
        {...(options.project === undefined ? {} : { project: options.project })}
        {...(options.scriptEntry === undefined ? {} : { scriptEntry: options.scriptEntry })}
      />
    )
  }
}

export const Page = Document
export const Flash = (message: string) =>
  `<div class="flash info" role="status">${escapeHtml(message)}</div>`
