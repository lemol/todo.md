/** @jsxImportSource remix/ui */
import { Badge, type BadgeTone, Button, Field, Heading, LinkButton } from "@lemol/ui/remix"
import type { Handle, RemixNode } from "remix/ui"
import type { TaskDetail } from "../../../core/index.ts"
import type { Capabilities, Task } from "../../../spec/index.ts"
import type { EditValues } from "../actions/forms.ts"
import { routes } from "../routes.ts"
import { formatDate, formatMinute, showId } from "./format.ts"
import { markdownHtml } from "./markdown.tsx"

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

const metadata = (task: Task, state: string): RemixNode => {
  const facts = [
    ["State", state],
    ["Group", task.group ?? "Ungrouped"],
    ["Tags", task.tags.length === 0 ? "None" : task.tags.map((tag) => `#${tag}`).join(" ")],
    ["Assignee", task.assignee === undefined ? "Unassigned" : `@${task.assignee}`],
    // Absent `outcome` on a done task means completed (spec §1.1): branch on
    // "cancelled" explicitly so every historical done task keeps reading as
    // completed.
    ...(task.status === "done"
      ? task.outcome === "cancelled"
        ? [
            ["Cancelled", formatDate(task.completedAt)],
            ...(task.cancelledReason === undefined ? [] : [["Reason", task.cancelledReason]]),
          ]
        : [["Completed", formatDate(task.completedAt)]]
      : []),
  ]
  return (
    <dl class="metadata">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            <code>{value}</code>
          </dd>
        </div>
      ))}
    </dl>
  )
}

const issueList = (issues: ReadonlyArray<string>): RemixNode =>
  issues.length === 0 ? null : (
    <ul class="issues">
      {issues.map((issue) => (
        <li key={issue}>{issue}</li>
      ))}
    </ul>
  )

export interface MoveFormProps {
  readonly project: string
  readonly task: Task
  readonly capabilities: Capabilities
  readonly groups: ReadonlyArray<string>
  readonly issues: ReadonlyArray<string>
}

/** Moves an open task to the top or bottom of a group, like `todo mv`. */
export function MoveForm(handle: Handle<MoveFormProps>) {
  return () => {
    const { project, task, capabilities, groups, issues } = handle.props
    const groupFields = capabilities.groups ? (
      <>
        <Field control="select" label="Group" name="group">
          <option value="" {...(task.group === undefined ? { selected: true } : {})}>
            Ungrouped
          </option>
          {groups.map((group) => (
            <option value={group} key={group} {...(task.group === group ? { selected: true } : {})}>
              {group}
            </option>
          ))}
          <option value="__new__">new group…</option>
        </Field>
        <Field label="New group" name="newGroup" />
      </>
    ) : null

    return (
      <section>
        <Heading level={2}>Move</Heading>
        {issueList(issues)}
        <form
          class="move-form"
          method="post"
          action={routes.project.tasks.move.href({ project, id: task.id })}
        >
          <input
            type="hidden"
            name="back"
            value={routes.project.tasks.show.href({ project, id: task.id })}
          />
          {groupFields}
          <Field control="select" label="Position" name="position">
            <option value="bottom">Bottom</option>
            <option value="top">Top</option>
          </Field>
          <Button tone="neutral" type="submit">
            Move
          </Button>
        </form>
      </section>
    )
  }
}

export interface TaskPageProps {
  readonly project: string
  readonly detail: TaskDetail
  readonly capabilities: Capabilities
  readonly author: string
  readonly groups?: ReadonlyArray<string> | undefined
  readonly moveIssues?: ReadonlyArray<string> | undefined
}

export function TaskPage(handle: Handle<TaskPageProps>) {
  return () => {
    const { detail, project, capabilities, author, groups = [], moveIssues = [] } = handle.props
    const task = detail.view.task

    const dependencies =
      detail.dependencies.length === 0 ? (
        <p class="empty">No dependencies.</p>
      ) : (
        <ul>
          {detail.dependencies.map((dependency) => (
            <li key={dependency.id}>
              <a href={routes.project.tasks.show.href({ project, id: dependency.id })}>
                {showId(dependency.id)} {dependency.title ?? "unknown"}
              </a>{" "}
              <Badge tone={badgeToneForState(dependency.state)}>
                {dependency.state.toUpperCase()}
              </Badge>
            </li>
          ))}
        </ul>
      )

    const blocks =
      detail.blocks.length === 0 ? (
        <p class="empty">Blocks nothing.</p>
      ) : (
        <ul>
          {detail.blocks.map((view) => (
            <li key={view.task.id}>
              <a href={routes.project.tasks.show.href({ project, id: view.task.id })}>
                {showId(view.task.id)} {view.task.title}
              </a>
            </li>
          ))}
        </ul>
      )

    const comments =
      task.comments.length === 0 ? (
        <p class="empty">No comments.</p>
      ) : (
        task.comments.map((comment, index) => (
          <article class="comment" key={index}>
            <div class="comment-by">
              <code>
                @{comment.author} · {formatMinute(comment.at)}
              </code>
            </div>
            <div class="markdown" innerHTML={markdownHtml(comment.body)} />
          </article>
        ))
      )

    const cancelForm =
      task.status === "open" && capabilities.cancel ? (
        <form
          class="cancel-form"
          method="post"
          action={routes.project.tasks.cancel.href({ project, id: task.id })}
        >
          <input
            type="hidden"
            name="back"
            value={routes.project.tasks.show.href({ project, id: task.id })}
          />
          <Field label="Reason" name="reason" required />
          <Button tone="neutral" type="submit">
            Cancel
          </Button>
        </form>
      ) : null

    const transition =
      task.status === "open" ? (
        <>
          <form method="post" action={routes.project.tasks.complete.href({ project, id: task.id })}>
            <input
              type="hidden"
              name="back"
              value={routes.project.tasks.show.href({ project, id: task.id })}
            />
            <Button tone="primary" type="submit">
              Complete
            </Button>
          </form>
          {cancelForm}
        </>
      ) : (
        <form method="post" action={routes.project.tasks.reopen.href({ project, id: task.id })}>
          <Button tone="primary" type="submit">
            Reopen
          </Button>
        </form>
      )

    const commentForm = capabilities.comments ? (
      <form
        class="comment-form"
        method="post"
        action={routes.project.tasks.comments.href({ project, id: task.id })}
      >
        <Field label="Author" name="author" value={author} required />
        <Field control="textarea" label="Comment" name="body" required />
        <Button tone="primary" type="submit">
          Comment
        </Button>
      </form>
    ) : null

    const move =
      task.status === "open" && capabilities.reorder ? (
        <MoveForm
          project={project}
          task={task}
          capabilities={capabilities}
          groups={groups}
          issues={moveIssues}
        />
      ) : null

    const remove = capabilities.remove ? (
      <LinkButton
        tone="neutral"
        href={routes.project.tasks.confirmRemove.href({ project, id: task.id })}
      >
        Remove
      </LinkButton>
    ) : null

    return (
      <>
        <div class="task-heading">
          <div>
            <code>{showId(task.id)}</code>
            <Heading level={1}>{task.title}</Heading>
          </div>
          <div class="actions">
            {transition}
            <LinkButton
              tone="neutral"
              href={routes.project.tasks.edit.href({ project, id: task.id })}
            >
              Edit
            </LinkButton>
            {remove}
          </div>
        </div>
        {metadata(task, detail.view.state)}
        {task.description === "" ? null : (
          <section>
            <Heading level={2}>Description</Heading>
            <div class="markdown" innerHTML={markdownHtml(task.description)} />
          </section>
        )}
        <section>
          <Heading level={2}>Dependencies</Heading>
          {dependencies}
        </section>
        <section>
          <Heading level={2}>Blocks</Heading>
          {blocks}
        </section>
        {move}
        <section>
          <Heading level={2}>Comments</Heading>
          {comments}
          {commentForm}
        </section>
      </>
    )
  }
}

export interface RemoveTaskPageProps {
  readonly project: string
  readonly task: Pick<Task, "id" | "title">
  readonly dependents: ReadonlyArray<Pick<Task, "id" | "title">>
  readonly issues?: ReadonlyArray<string> | undefined
}

/**
 * Asks before deleting. With open dependents it lists them and the button
 * sends `force`, since removing leaves them with an unknown dependency.
 */
export function RemoveTaskPage(handle: Handle<RemoveTaskPageProps>) {
  return () => {
    const { project, task, dependents, issues = [] } = handle.props
    const warning =
      dependents.length === 0 ? null : (
        <>
          <p class="warning">
            These open tasks depend on it and will be left with an unknown dependency:
          </p>
          <ul>
            {dependents.map((dependent) => (
              <li key={dependent.id}>
                <a href={routes.project.tasks.show.href({ project, id: dependent.id })}>
                  {showId(dependent.id)} {dependent.title}
                </a>
              </li>
            ))}
          </ul>
        </>
      )

    return (
      <>
        <Heading level={1}>Remove task {showId(task.id)}</Heading>
        {issueList(issues)}
        <p>
          Remove{" "}
          <a href={routes.project.tasks.show.href({ project, id: task.id })}>
            {showId(task.id)} {task.title}
          </a>{" "}
          for good? This deletes the task and its file; version control keeps the history.
        </p>
        {warning}
        <form
          class="actions confirm"
          method="post"
          action={routes.project.tasks.remove.href({ project, id: task.id })}
        >
          {dependents.length === 0 ? null : <input type="hidden" name="force" value="1" />}
          <Button tone="danger" type="submit">
            {dependents.length === 0 ? "Remove" : "Remove anyway"}
          </Button>
          <LinkButton
            tone="neutral"
            href={routes.project.tasks.show.href({ project, id: task.id })}
          >
            Cancel
          </LinkButton>
        </form>
      </>
    )
  }
}

export const valuesOf = (task: Task): EditValues => ({
  title: task.title,
  description: task.description,
  tags: task.tags.join(" "),
  assignee: task.assignee ?? "",
  dependsOn: task.dependsOn.join(" "),
})

export interface EditTaskPageProps {
  readonly project: string
  readonly task: Pick<Task, "id">
  readonly values: EditValues
  readonly issues?: ReadonlyArray<string> | undefined
}

export function EditTaskPage(handle: Handle<EditTaskPageProps>) {
  return () => {
    const { project, task, values, issues = [] } = handle.props
    return (
      <>
        <Heading level={1}>Edit task {showId(task.id)}</Heading>
        {issueList(issues)}
        <form
          class="edit-form"
          method="post"
          action={routes.project.tasks.update.href({ project, id: task.id })}
        >
          <Field label="Title" name="title" value={values.title} required />
          <Field
            control="textarea"
            label="Description"
            name="description"
            value={values.description}
          />
          <Field label="Tags" name="tags" value={values.tags} />
          <Field label="Assignee" name="assignee" value={values.assignee} />
          <Field label="Depends on" name="dependsOn" value={values.dependsOn} />
          <Button tone="primary" type="submit">
            Save
          </Button>
        </form>
      </>
    )
  }
}
