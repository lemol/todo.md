/** @jsxImportSource remix/component */

import { EmptyState } from "@lemol/ui/mini"
import {
  Badge,
  type BadgeTone,
  Button,
  Checkbox,
  Field,
  Heading,
  LinkButton,
  LiveForm,
  liveSubmit,
  Stack,
} from "@lemol/ui/remix"
import type { DateTime } from "effect"
import { attrs, type Handle, type RemixNode } from "remix/component"
import type { TaskView } from "../../../core/index.ts"
import type { Overview, OverviewEntry, OverviewTask, ProjectInfo } from "../../../hub/index.ts"
import { type DashboardQuery, dashboardHref } from "../actions/dashboard/query.ts"
import { routes } from "../routes.ts"
import { showId } from "./format.ts"
import { syncStatusBadge } from "./status.tsx"

export interface DashboardOptions {
  readonly overview: Overview
  /** Every project, for the filter bar; in registry order, unregistered last. */
  readonly projects: ReadonlyArray<ProjectInfo>
  /** The source kinds the hub loaded, for the filter bar. */
  readonly sources: ReadonlyArray<string>
  readonly query: DashboardQuery
  readonly now: DateTime.Utc
  /** True when some project can sync, which is what makes Sync all worth showing. */
  readonly syncable: boolean
}

const MAX_NEXT = 5

const openTasks = (entry: Extract<OverviewEntry, { listing: unknown }>): ReadonlyArray<TaskView> =>
  entry.listing.sections.flatMap((section) => section.tasks)

const badgeToneForState = (state: string): BadgeTone => {
  switch (state) {
    case "ready":
      return "success"
    case "blocked":
      return "warning"
    default:
      return "neutral"
  }
}

const counts = (tasks: ReadonlyArray<TaskView>): RemixNode => {
  const ready = tasks.filter((view) => view.state === "ready").length
  const blocked = tasks.length - ready
  return (
    <span class="counts">
      {tasks.length} open · {ready} ready · {blocked} blocked
    </span>
  )
}

const registerForm = (info: ProjectInfo): RemixNode => (
  <form method="post" action={routes.projects.add.href()} class="inline">
    <input type="hidden" name="target" value={info.location} />
    <input type="hidden" name="name" value={info.name} />
    <input type="hidden" name="source" value={info.source} />
    <button class="secondary" type="submit">
      Register
    </button>
  </form>
)

const syncForm = (name: string, back: string): RemixNode => (
  <form method="post" action={routes.project.sync.href({ project: name })} class="inline">
    <input type="hidden" name="back" value={back} />
    <button class="secondary" type="submit">
      Sync
    </button>
  </form>
)

const projectHeading = (entry: OverviewEntry, now: DateTime.Utc, back: string): RemixNode => {
  const info = entry.project
  const title = "listing" in entry ? entry.listing.title : info.name
  return (
    <div class="project-heading">
      <Heading level={2}>
        <a href={routes.project.board.href({ project: info.name })}>{title}</a>
      </Heading>
      <Badge tone="neutral">{info.source}</Badge>
      {info.syncable ? syncStatusBadge(info.status, now) : null}
      {info.registered ? null : (
        <>
          <Badge tone="warning">not registered</Badge>
          {registerForm(info)}
        </>
      )}
      {info.syncable ? syncForm(info.name, back) : null}
    </div>
  )
}

const nextRow = (project: string, view: TaskView): RemixNode => (
  <li key={view.task.id}>
    <code>
      {project}:{showId(view.task.id)}
    </code>{" "}
    <a href={routes.project.tasks.show.href({ project, id: view.task.id })}>{view.task.title}</a>
  </li>
)

const projectSection = (entry: OverviewEntry, now: DateTime.Utc, back: string): RemixNode => {
  const heading = projectHeading(entry, now, back)
  if (!("listing" in entry)) {
    const retry = entry.project.syncable ? null : syncForm(entry.project.name, back)
    return (
      <section class="project project-error" key={entry.project.name}>
        {heading}
        <p class="badge error">{entry.error.message}</p>
        {retry}
      </section>
    )
  }
  const tasks = openTasks(entry)
  const ready = tasks.filter((view) => view.state === "ready")
  const shown = ready.slice(0, MAX_NEXT)
  const rest = ready.length - shown.length
  const body =
    shown.length === 0 ? (
      <p class="empty">Nothing ready.</p>
    ) : (
      <>
        <ul class="next-tasks">{shown.map((view) => nextRow(entry.project.name, view))}</ul>
        {rest === 0 ? null : (
          <p class="muted">
            <a href={routes.project.board.href({ project: entry.project.name })}>{rest} more</a>
          </p>
        )}
      </>
    )
  return (
    <section class="project" key={entry.project.name}>
      {heading}
      {counts(tasks)}
      {body}
    </section>
  )
}

const flatRow = (task: OverviewTask): RemixNode => (
  <article class="task-row" key={`${task.project}:${task.view.task.id}`}>
    <code>{task.ref}</code>
    <div class="task-copy">
      <a
        class="task-title"
        href={routes.project.tasks.show.href({ project: task.project, id: task.view.task.id })}
      >
        {task.view.task.title}
      </a>
    </div>
    <div class="task-meta">
      <a class="chip" href={routes.project.board.href({ project: task.project })}>
        {task.project}
      </a>{" "}
      <Badge tone={badgeToneForState(task.view.state)}>{task.view.state.toUpperCase()}</Badge>
    </div>
  </article>
)

const filterBar = (options: DashboardOptions): RemixNode => {
  const { query, projects, sources } = options
  const submitAttr = liveSubmit("dashboard-filters")
  return (
    <LiveForm
      mix={attrs({ class: "filters" })}
      id="dashboard-filters"
      method="get"
      action={routes.dashboard.href()}
    >
      <fieldset>
        <legend>Projects</legend>
        {projects.map((info) => (
          <Checkbox
            key={info.name}
            name="project"
            value={info.name}
            checked={query.projects.includes(info.name)}
            label={info.name}
            mix={submitAttr}
          />
        ))}
      </fieldset>
      <fieldset>
        <legend>Sources</legend>
        {sources.map((kind) => (
          <Checkbox
            key={kind}
            name="source"
            value={kind}
            checked={query.sources.includes(kind)}
            label={kind}
            mix={submitAttr}
          />
        ))}
      </fieldset>
      <Field label="Tag" name="tag" value={query.tags.join(" ")} mix={submitAttr} />
      <Field label="Assignee" name="assignee" value={query.assignee ?? ""} mix={submitAttr} />
      <Field control="select" label="State" name="state" mix={submitAttr}>
        <option value="" {...((query.state ?? "") === "" ? { selected: true } : {})}>
          Any state
        </option>
        <option value="ready" {...(query.state === "ready" ? { selected: true } : {})}>
          ready
        </option>
        <option value="blocked" {...(query.state === "blocked" ? { selected: true } : {})}>
          blocked
        </option>
      </Field>
      <Field control="select" label="View" name="view" mix={submitAttr}>
        <option value="projects" {...(query.view === "projects" ? { selected: true } : {})}>
          By project
        </option>
        <option value="flat" {...(query.view === "flat" ? { selected: true } : {})}>
          Flat
        </option>
      </Field>
      <Button type="submit">Filter</Button>
    </LiveForm>
  )
}

/** The dashboard body. `back` is where the sync forms return to. */
export function DashboardPage(handle: Handle<DashboardOptions>) {
  return () => {
    const options = handle.props
    const back = dashboardHref(options.query)
    if (options.projects.length === 0) {
      return (
        <Stack gap={4}>
          <Heading level={1}>Projects</Heading>
          <EmptyState
            title="No projects yet."
            action={<LinkButton href={routes.projects.index.href()}>Add one.</LinkButton>}
          />
        </Stack>
      )
    }
    const syncAll = options.syncable ? (
      <form method="post" action={routes.sync.href()} class="inline">
        <input type="hidden" name="back" value={back} />
        <Button type="submit">Sync all</Button>
      </form>
    ) : null

    const body =
      options.query.view === "flat" ? (
        options.overview.tasks.length === 0 ? (
          <p class="empty">Nothing matches these filters.</p>
        ) : (
          options.overview.tasks.map(flatRow)
        )
      ) : options.overview.projects.length === 0 ? (
        <p class="empty">Nothing matches these filters.</p>
      ) : (
        options.overview.projects.map((entry) => projectSection(entry, options.now, back))
      )

    return (
      <>
        <div class="page-heading">
          <Heading level={1}>Projects</Heading>
          {syncAll}
        </div>
        {filterBar(options)}
        {body}
      </>
    )
  }
}
