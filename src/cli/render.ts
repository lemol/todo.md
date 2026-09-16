import { DateTime } from "effect"
import type { Completion, Listing, TaskDetail, TaskView } from "../core/index.ts"
import {
  formatRef,
  type Overview,
  type OverviewTask,
  type ProjectInfo,
  type SyncFailure,
  type SyncResult,
} from "../hub/index.ts"

export { statusText } from "../hub/index.ts"

import type { Diagnostic, Task } from "../spec/index.ts"
import { describeError } from "./errors.ts"
import type { Style } from "./style.ts"

/** A task ID as people read it: numeric IDs padded like the file format (`7` → `07`). */
export const showId = (id: string): string => (/^\d+$/.test(id) ? id.padStart(2, "0") : id)

/** `07  Title`: how every message names a task. */
export const label = (task: Task): string => `${showId(task.id)}  ${task.title}`

const day = (task: Task) =>
  task.completedAt === undefined ? "" : DateTime.formatIso(task.completedAt).slice(0, 10)

const minute = (at: DateTime.Utc) => DateTime.formatIso(at).slice(0, 16).replace("T", " ")

const meta = (task: Task): string =>
  [
    ...task.tags.map((tag) => `#${tag}`),
    ...(task.assignee === undefined ? [] : [`@${task.assignee}`]),
  ].join(" ")

const indented = (text: string, spaces: number): string[] =>
  text.split("\n").map((line) => (line === "" ? "" : `${" ".repeat(spaces)}${line}`))

/**
 * Task lines as the list shows them: `  <id>  <title>  <#tags @assignee>`,
 * titles padded so the extras line up, and a `blocked by` line under blocked
 * tasks. Done tasks show their completion date instead of tags.
 */
export const taskLines = (
  views: ReadonlyArray<TaskView>,
  style: Style,
  idOf: (id: string) => string = showId,
): string[] => {
  const idWidth = Math.max(2, ...views.map((v) => idOf(v.task.id).length))
  const titleWidth = Math.min(50, Math.max(0, ...views.map((v) => v.task.title.length)))
  return views.flatMap((v) => {
    const extra = v.state === "done" ? day(v.task) : meta(v.task)
    const title = extra === "" ? v.task.title : v.task.title.padEnd(titleWidth)
    const head = `  ${idOf(v.task.id).padEnd(idWidth)}  ${title}`
    const line = extra === "" ? head : `${head}  ${style.dim(extra)}`
    if (v.state !== "blocked") return [line]
    const blocked = `blocked by ${v.blockedBy.map(idOf).join(", ")}`
    return [line, `${" ".repeat(idWidth + 4)}${style.yellow(blocked)}`]
  })
}

/** `todo list`: the outline of the list, like TODO.md, and a summary line. */
export const renderListing = (
  listing: Listing,
  style: Style,
  idOf: (id: string) => string = showId,
): string[] => {
  const lines: string[] = []
  if (listing.title !== "") lines.push(style.bold(listing.title), "")
  for (const section of listing.sections.filter((s) => s.tasks.length > 0)) {
    if (section.name !== undefined) lines.push(style.bold(section.name))
    lines.push(...taskLines(section.tasks, style, idOf), "")
  }
  if (listing.done.length > 0) {
    lines.push(style.bold("Done"), ...taskLines(listing.done, style, idOf), "")
  }
  const open = listing.sections.flatMap((section) => section.tasks)
  if (open.length === 0 && listing.done.length === 0) return [...lines, "No tasks."]
  const count = (state: string) => open.filter((v) => v.state === state).length
  const summary = [
    ...(listing.sections.length > 0
      ? [`${open.length} open`, `${count("ready")} ready`, `${count("blocked")} blocked`]
      : []),
    ...(listing.done.length > 0 ? [`${listing.done.length} done`] : []),
  ]
  return [...lines, style.dim(summary.join(" · "))]
}

/** `todo show`: one task with its state, description, dependencies and comments. */
export const renderDetail = (detail: TaskDetail, style: Style): string[] => {
  const { task, state, blockedBy } = detail.view
  const status =
    state === "blocked"
      ? style.yellow(`blocked by ${blockedBy.map(showId).join(", ")}`)
      : state === "done"
        ? style.green(`done ${day(task)}`.trim())
        : style.green("ready")
  const facts = [
    status,
    ...(task.group === undefined ? [] : [task.group]),
    ...(meta(task) === "" ? [] : [meta(task)]),
  ]
  const lines = [style.bold(label(task)), `    ${facts.join(" · ")}`]
  if (task.description !== "") lines.push("", ...indented(task.description, 4))
  if (detail.dependencies.length > 0) {
    lines.push("", "    Depends on")
    for (const d of detail.dependencies) {
      lines.push(`      ${showId(d.id)}  ${d.title ?? "(unknown task)"}  ${style.dim(d.state)}`)
    }
  }
  if (detail.blocks.length > 0) {
    lines.push("", "    Blocks")
    for (const b of detail.blocks) lines.push(`      ${label(b.task)}  ${style.dim(b.state)}`)
  }
  if (task.comments.length > 0) {
    lines.push("", "    Comments")
    for (const comment of task.comments) {
      lines.push(`      ${style.dim(`@${comment.author} at ${minute(comment.at)}`)}`)
      lines.push(...indented(comment.body, 8))
    }
  }
  return lines
}

/** `ls --all`: every project's listing under a `# <project>` heading, with qualified IDs. */
export const renderOverview = (view: Overview, style: Style): string[] => {
  const blocks = view.projects.map((entry) => [
    `# ${entry.project.name}`,
    ...("listing" in entry
      ? renderListing(entry.listing, style, (id) => formatRef(entry.project.name, showId(id)))
      : [`error: ${describeError(entry.error)}`]),
  ])
  return blocks.flatMap((lines, index) => (index === 0 ? lines : ["", ...lines]))
}

/** `next --all`: the given ready tasks grouped under their project's heading. */
export const renderNextOverview = (
  view: Overview,
  tasks: ReadonlyArray<OverviewTask>,
  style: Style,
): string[] => {
  const blocks: string[][] = []
  for (const entry of view.projects) {
    if ("error" in entry) {
      blocks.push([`# ${entry.project.name}`, `error: ${describeError(entry.error)}`])
      continue
    }
    const mine = tasks.filter((item) => item.project === entry.project.name)
    if (mine.length === 0) continue
    blocks.push([
      `# ${entry.project.name}`,
      ...taskLines(
        mine.map((item) => item.view),
        style,
        (id) => formatRef(entry.project.name, showId(id)),
      ),
    ])
  }
  return blocks.flatMap((lines, index) => (index === 0 ? lines : ["", ...lines]))
}

/** One `todo projects` line: name, source, location, open and ready counts, status. */
export const projectLine = (args: {
  readonly info: ProjectInfo
  readonly open: number
  readonly ready: number
  readonly status: string
}): string =>
  `${args.info.name}${args.info.registered ? "" : " (not registered)"}  ${args.info.source}  ${args.info.location}  ${args.open} open · ${args.ready} ready  ${args.status}`

/** One `todo sync` line per project. */
export const syncLine = (outcome: SyncResult | SyncFailure): string =>
  "error" in outcome
    ? `${outcome.project}: error (${outcome.error.reason}): ${outcome.error.message}`
    : `${outcome.project}: ${outcome.summary}`

/** `todo done`: what was completed and what became ready. */
export const renderCompletions = (
  completions: ReadonlyArray<Completion>,
  style: Style,
): string[] => {
  const completed = new Set(completions.map((c) => c.task.id))
  const ready = new Map<string, TaskView>()
  for (const view of completions.flatMap((c) => c.unblocked)) {
    if (!completed.has(view.task.id)) ready.set(view.task.id, view)
  }
  return [
    ...completions.map((c) => `Done ${label(c.task)}`),
    ...(ready.size === 0 ? [] : ["Now ready:", ...taskLines([...ready.values()], style)]),
  ]
}

const where = (d: Diagnostic): string => {
  if (d.file !== undefined) return d.line === undefined ? d.file : `${d.file}:${d.line}`
  return d.taskId === undefined ? "-" : `task ${showId(d.taskId)}`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** `todo check`: one line per diagnostic, errors first, and a summary. */
export const renderDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
  style: Style,
): string[] => {
  if (diagnostics.length === 0) return ["No problems found."]
  const rank = { error: 0, warning: 1, info: 2 } as const
  const color = { error: style.red, warning: style.yellow, info: style.dim } as const
  const sorted = [...diagnostics].sort((a, b) => rank[a.severity] - rank[b.severity])
  const count = (severity: Diagnostic["severity"]) =>
    diagnostics.filter((d) => d.severity === severity).length
  const summary = [
    ...(count("error") > 0 ? [plural(count("error"), "error")] : []),
    ...(count("warning") > 0 ? [plural(count("warning"), "warning")] : []),
    ...(count("info") > 0 ? [plural(count("info"), "note")] : []),
  ]
  return [
    ...sorted.map(
      (d) => `${color[d.severity](d.severity.padEnd(7))}  ${where(d)}  ${d.code}  ${d.message}`,
    ),
    "",
    summary.join(" · "),
  ]
}
