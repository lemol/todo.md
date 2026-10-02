/** @jsxImportSource remix/component */
import { AppShell, ErrorState, Nav, type NavItem } from "@lemol/ui/mini"
import { Document as MiniDocument } from "@lemol/ui/mini/document"
import {
  Badge,
  Button,
  CommandPaletteInput,
  CommandPaletteItem,
  CommandPaletteList,
  LinkButton,
  overlay,
  Text,
  type ToastTone,
  toast,
} from "@lemol/ui/remix"
import type { ScriptEntry } from "remix/assets"
import { css, type Handle, type RemixNode, unsafeHTML } from "remix/component"
import { routes } from "../routes.ts"
import { theme } from "./theme.ts"

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
  readonly content?: string
  readonly children?: RemixNode
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
  readonly currentNav?: "dashboard" | "projects" | "board" | "done" | "check"
}

const switcherStyle = css({
  display: "flex",
  gap: "var(--sp-2)",
  alignItems: "center",
})

const visuallyHiddenStyle = css({
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
})

const switcherSelectStyle = css({
  maxWidth: "180px",
  height: "var(--control-h-sm)",
  paddingInline: "var(--sp-2)",
  borderRadius: "var(--r-sm)",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "var(--hairline)",
  background: "var(--surface)",
  color: "inherit",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
})

const flashToast = toast("flash-toast")

const Palette = overlay("command-palette")
const paletteListId = "command-palette-list"

const actionsStyle = css({
  display: "flex",
  gap: "var(--sp-2)",
  alignItems: "center",
})

const reloadNoticeStyle = css({
  padding: "var(--sp-3) var(--sp-4)",
  borderRadius: "var(--r-sm)",
  fontSize: "var(--fs-sm)",
  lineHeight: "var(--lh-base)",
  marginBottom: "var(--sp-4)",
  background: "var(--info-subtle)",
  color: "var(--info)",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "var(--info-border)",
  "& a": {
    color: "inherit",
    fontWeight: "var(--fw-semibold)",
    textDecoration: "underline",
  },
})

export function Document(handle: Handle<DocumentOptions>) {
  return () => {
    const options = handle.props
    const project = options.project
    const boardHref = project === undefined ? "/" : routes.project.board.href({ project })
    const brand =
      project === undefined ? (
        options.title
      ) : (
        <>
          {options.title} <Badge tone="neutral">{project}</Badge>
        </>
      )

    const errors = options.diagnostics?.error ?? 0
    const warnings = options.diagnostics?.warning ?? 0
    const checkLabel =
      errors > 0 || warnings > 0
        ? `Check (${errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : `${warnings} warning${warnings === 1 ? "" : "s"}`})`
        : "Check"

    const current =
      options.currentNav ??
      (options.pageTitle?.startsWith("Done")
        ? "done"
        : options.pageTitle?.startsWith("Check")
          ? "check"
          : options.pageTitle?.startsWith("Dashboard") || options.title === "Dashboard"
            ? "dashboard"
            : options.pageTitle?.startsWith("Projects") || options.title === "Projects"
              ? "projects"
              : project !== undefined
                ? "board"
                : undefined)

    const navItems: NavItem[] = [
      { href: routes.dashboard.href(), label: "Dashboard", current: current === "dashboard" },
      { href: routes.projects.index.href(), label: "Projects", current: current === "projects" },
    ]

    if (project !== undefined) {
      navItems.push(
        { href: boardHref, label: "Board", current: current === "board" },
        { href: routes.project.done.href({ project }), label: "Done", current: current === "done" },
        {
          href: routes.project.check.href({ project }),
          label: checkLabel,
          current: current === "check",
        },
      )
    }

    const nav = <Nav items={navItems} />

    const switcher =
      options.switcher === undefined || options.switcher.length === 0 ? null : (
        <form action={routes.go.href()} class="switcher" method="get" mix={switcherStyle}>
          <label class="visually-hidden" for="switch-project" mix={visuallyHiddenStyle}>
            Project
          </label>
          <select
            id="switch-project"
            mix={switcherSelectStyle}
            name="project"
            data-submit-on-change
          >
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
          <Button size="sm" type="submit">
            Go
          </Button>
        </form>
      )

    const commandPaletteDialog = (
      <Palette.Dialog title="Command Palette">
        <CommandPaletteInput listId={paletteListId} placeholder="Type a command or page…" />
        <CommandPaletteList id={paletteListId}>
          <CommandPaletteItem
            href={routes.dashboard.href()}
            id="cmd-dashboard"
            label="Dashboard"
            keywords="home overview"
          />
          <CommandPaletteItem
            href={routes.projects.index.href()}
            id="cmd-projects"
            label="Projects"
            keywords="repositories manage"
          />
          {project !== undefined ? (
            <>
              <CommandPaletteItem
                href={routes.project.board.href({ project })}
                id="cmd-board"
                label={`Board (${project})`}
                keywords="tasks list"
              />
              <CommandPaletteItem
                href={routes.project.done.href({ project })}
                id="cmd-done"
                label={`Done (${project})`}
                keywords="completed archive"
              />
              <CommandPaletteItem
                href={routes.project.check.href({ project })}
                id="cmd-check"
                label={`Check (${project})`}
                keywords="diagnostics errors warnings"
              />
            </>
          ) : null}
          {options.switcher?.map((entry) => (
            <CommandPaletteItem
              key={entry.name}
              href={routes.project.board.href({ project: entry.name })}
              id={`cmd-switch-${entry.name}`}
              label={`Switch to project: ${entry.name}`}
              keywords="switch project"
            />
          ))}
          <CommandPaletteItem
            href={routes.sync.href()}
            id="cmd-sync"
            label="Sync all projects"
            keywords="sync refresh"
          />
          <CommandPaletteItem
            href={`${routes.projects.index.href()}#add-project`}
            id="cmd-add-project"
            label="Add a project"
            keywords="new project create"
          />
        </CommandPaletteList>
        <Text tone="muted">Typing filters the list. Esc closes.</Text>
      </Palette.Dialog>
    )

    const actions = (
      <div mix={actionsStyle}>
        <Palette.Trigger size="sm" tone="neutral">
          ⌘K
        </Palette.Trigger>
        {switcher}
      </div>
    )

    const mapFlashTone = (tone: "info" | "warning" | "error"): ToastTone => {
      if (tone === "error") return "danger"
      return tone
    }

    const flash =
      options.flash === undefined ? null : (
        <>
          <flashToast.Toast tone={mapFlashTone(options.flash.tone)}>
            {options.flash.message}
          </flashToast.Toast>
          <noscript>
            <div class={`flash ${options.flash.tone}`} role="status">
              {options.flash.message}
            </div>
          </noscript>
        </>
      )

    const reloadNotice = (
      <div class="reload-notice info" data-reload-notice hidden mix={reloadNoticeStyle}>
        The list changed. <a href={boardHref}>Reload</a>
      </div>
    )

    const content =
      options.children ??
      (options.content === undefined ? null : <div innerHTML={unsafeHTML(options.content)} />)

    const liveRegion = (
      <div
        data-live-region
        {...(project === undefined ? {} : { "data-project": project })}
        {...(options.liveEvents === undefined
          ? {}
          : { "data-live-events": options.liveEvents.join(" ") })}
      >
        {content}
      </div>
    )

    return (
      <MiniDocument
        entry={options.scriptEntry}
        theme={theme}
        title={options.pageTitle ?? options.title}
      >
        <AppShell actions={actions} brand={brand} brandHref={boardHref} nav={nav}>
          {commandPaletteDialog}
          {flash}
          {reloadNotice}
          {liveRegion}
        </AppShell>
      </MiniDocument>
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
        {...(options.project === undefined ? {} : { project: options.project })}
        {...(options.scriptEntry === undefined ? {} : { scriptEntry: options.scriptEntry })}
      >
        <ErrorState
          level={1}
          status={String(options.status)}
          title={`${options.status} error`}
          description={options.message}
          action={<LinkButton href={back}>Back to board</LinkButton>}
        />
      </Document>
    )
  }
}

export const Page = Document
export const Flash = (message: string) =>
  `<div class="flash info" role="status">${escapeHtml(message)}</div>`
