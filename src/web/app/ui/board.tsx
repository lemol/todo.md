/** @jsxImportSource remix/ui */
import { Badge, type BadgeTone, Button, Field, Heading } from "@lemol/ui/remix"
import type { Handle, RemixNode } from "remix/ui"
import type { Listing, TaskView } from "../../../core/index.ts"
import type { Capabilities } from "../../../spec/index.ts"
import { routes } from "../routes.ts"
import { showId } from "./format.ts"
import { markdownHtml } from "./markdown.tsx"

export interface AddValues {
  readonly title: string
  readonly group: string
  readonly newGroup: string
}

const queryHref = (project: string, back: string, name: string, value: string): string => {
  const current = new URL(back, "http://todo-md.local")
  const query = current.searchParams
  if (name === "tag") {
    if (!query.getAll(name).includes(value)) query.append(name, value)
  } else query.set(name, value)
  return `${routes.project.board.href({ project })}?${query}`
}

/** Up moves before the row above, down after the row below; absent at the section's edges. */
export interface RowMoves {
  readonly above: string | undefined
  readonly below: string | undefined
}

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

const moveButton = (
  project: string,
  task: TaskView["task"],
  back: string,
  anchor: "before" | "after",
  target: string | undefined,
): RemixNode => {
  const [label, arrow] = anchor === "before" ? ["up", "↑"] : ["down", "↓"]
  if (target === undefined) {
    return (
      <button class="move" type="button" disabled tabindex={-1}>
        {arrow}
      </button>
    )
  }
  return (
    <form method="post" action={routes.project.tasks.move.href({ project, id: task.id })}>
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name={anchor} value={target} />
      <button
        class="move"
        type="submit"
        title={`Move ${label}`}
        aria-label={`Move ${task.title} ${label}`}
      >
        {arrow}
      </button>
    </form>
  )
}

export interface TaskRowProps {
  readonly project: string
  readonly view: TaskView
  readonly next: boolean
  readonly back: string
  readonly moves?: RowMoves | undefined
}

export function TaskRow(handle: Handle<TaskRowProps>) {
  return () => {
    const { project, view, next, back, moves } = handle.props
    const { task } = view
    const tags = task.tags.flatMap((tag, index) => [
      ...(index > 0 ? [" "] : []),
      <a class="chip" key={tag} href={queryHref(project, back, "tag", tag)}>
        #{tag}
      </a>,
    ])
    const assignee =
      task.assignee === undefined ? null : (
        <>
          {" "}
          <a class="assignee" href={queryHref(project, back, "assignee", task.assignee)}>
            @{task.assignee}
          </a>
        </>
      )
    const blockedBy =
      view.blockedBy.length === 0 ? null : (
        <div class="blocked-by">
          blocked by{" "}
          {view.blockedBy.flatMap((id, index) => [
            ...(index > 0 ? [", "] : []),
            <a href={routes.project.tasks.show.href({ project, id })} key={id}>
              {showId(id)}
            </a>,
          ])}
        </div>
      )
    const moveButtons =
      moves === undefined ? null : (
        <span class="moves">
          {moveButton(project, task, back, "before", moves.above)}
          {moveButton(project, task, back, "after", moves.below)}
        </span>
      )

    return (
      <article class={`task-row${next ? " next" : ""}`} {...(next ? { "data-next": "true" } : {})}>
        <form method="post" action={routes.project.tasks.complete.href({ project, id: task.id })}>
          <input type="hidden" name="back" value={back} />
          <button class="checkbox" aria-label={`Complete ${task.title}`} type="submit" />
        </form>
        <code>{showId(task.id)}</code>
        <div class="task-copy">
          <a class="task-title" href={routes.project.tasks.show.href({ project, id: task.id })}>
            {task.title}
          </a>
          {blockedBy}
        </div>
        <div class="task-meta">
          {tags}
          {assignee} <Badge tone={badgeToneForState(view.state)}>{view.state.toUpperCase()}</Badge>
          {moveButtons}
        </div>
      </article>
    )
  }
}

export interface AddTaskFormProps {
  readonly project: string
  readonly listing: Listing
  readonly capabilities: Capabilities
  readonly values?: AddValues | undefined
  readonly issues?: ReadonlyArray<string> | undefined
}

export function AddTaskForm(handle: Handle<AddTaskFormProps>) {
  return () => {
    const {
      project,
      listing,
      capabilities,
      values = { title: "", group: "", newGroup: "" },
      issues = [],
    } = handle.props
    const groupFields = capabilities.groups ? (
      <>
        <Field control="select" label="Group" name="group">
          <option value="" {...(values.group === "" ? { selected: true } : {})}>
            Ungrouped
          </option>
          {listing.sections.flatMap((section) =>
            section.name === undefined
              ? []
              : [
                  <option
                    value={section.name}
                    key={section.name}
                    {...(values.group === section.name ? { selected: true } : {})}
                  >
                    {section.name}
                  </option>,
                ],
          )}
          <option value="__new__" {...(values.group === "__new__" ? { selected: true } : {})}>
            new group…
          </option>
        </Field>
        <Field label="New group" name="newGroup" value={values.newGroup} />
      </>
    ) : null

    return (
      <section class="add-task">
        <Heading level={2}>Add task</Heading>
        {issues.length === 0 ? null : (
          <ul class="issues">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        <form method="post" action={routes.project.tasks.add.href({ project })}>
          <Field label="Title" name="title" value={values.title} required />
          {groupFields}
          <Button tone="primary" type="submit">
            Add task
          </Button>
        </form>
      </section>
    )
  }
}

export interface BoardPageProps {
  readonly project: string
  readonly listing: Listing
  readonly nextIds: ReadonlySet<string>
  readonly capabilities: Capabilities
  readonly back: string
  readonly addValues?: AddValues | undefined
  readonly addIssues?: ReadonlyArray<string> | undefined
  readonly syncChrome?: RemixNode | undefined
}

export function BoardPage(handle: Handle<BoardPageProps>) {
  return () => {
    const { project, listing, nextIds, capabilities, back, addValues, addIssues, syncChrome } =
      handle.props

    const views = listing.sections.flatMap((section) => section.tasks)
    const ready = views.filter((view) => view.state === "ready").length
    const blocked = views.length - ready

    const sections = listing.sections
      .filter((section) => section.tasks.length > 0)
      .map((section) => {
        const heading =
          section.name === undefined ? (
            "Ungrouped"
          ) : (
            <>
              <a href={queryHref(project, back, "group", section.name)}>{section.name}</a>
              {capabilities.renameGroup ? (
                <>
                  {" "}
                  <a
                    class="section-action"
                    href={routes.project.groups.edit.href(
                      { project },
                      { searchParams: { name: section.name } },
                    )}
                  >
                    Rename
                  </a>
                </>
              ) : null}
            </>
          )

        return (
          <section class="task-section" key={section.name ?? "ungrouped"}>
            <Heading level={2}>{heading}</Heading>
            {section.description === "" ? null : (
              <div
                class="section-description markdown"
                innerHTML={markdownHtml(section.description)}
              />
            )}
            {section.tasks.map((view, index) => (
              <TaskRow
                key={view.task.id}
                project={project}
                view={view}
                next={nextIds.has(view.task.id)}
                back={back}
                {...(capabilities.reorder
                  ? {
                      moves: {
                        above: section.tasks[index - 1]?.task.id,
                        below: section.tasks[index + 1]?.task.id,
                      },
                    }
                  : {})}
              />
            ))}
          </section>
        )
      })

    const sync =
      syncChrome === undefined || syncChrome === null || syncChrome === "" ? null : (
        <p class="board-sync">{syncChrome}</p>
      )

    const addForm = capabilities.add ? (
      <AddTaskForm
        project={project}
        listing={listing}
        capabilities={capabilities}
        values={addValues}
        issues={addIssues}
      />
    ) : null

    const empty = capabilities.add ? (
      <p class="empty">Nothing open. Add a task above.</p>
    ) : (
      <p class="empty">Nothing open.</p>
    )

    return (
      <>
        <Heading level={1}>{listing.title}</Heading>
        {sync}
        {listing.description === "" ? null : (
          <div class="list-description markdown" innerHTML={markdownHtml(listing.description)} />
        )}
        <p class="summary">
          {views.length} open · {ready} ready · {blocked} blocked
        </p>
        {addForm}
        {sections.length > 0 ? sections : empty}
      </>
    )
  }
}
