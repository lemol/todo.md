/** @jsxImportSource remix/component */
import { Badge, type BadgeTone, Button, Field, Heading, LinkButton, overlay } from "@lemol/ui/remix"
import { type Handle, type RemixNode, unsafeHTML } from "remix/component"
import type { TaskDetail } from "../../../core/index.ts"
import type { Capabilities, Task } from "../../../spec/index.ts"
import type { EditValues } from "../actions/forms.ts"
import { routes } from "../routes.ts"
import { formatDate, formatMinute, showId } from "./format.ts"
import { markdownHtml } from "./markdown.tsx"

const EditTask = overlay("edit-task")
const MoveTask = overlay("move-task")
const RemoveTask = overlay("remove-task")

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
  readonly heading?: boolean | undefined
  readonly close?: RemixNode | undefined
}

/** Moves an open task to the top or bottom of a group, like `todo mv`. */
export function MoveForm(handle: Handle<MoveFormProps>) {
  return () => {
    const { project, task, capabilities, groups, issues, heading = true, close } = handle.props
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
      <section class="move-section">
        {heading ? <Heading level={2}>Move</Heading> : null}
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
          <div class="actions">
            <Button tone="neutral" type="submit">
              Move
            </Button>
            {close}
          </div>
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
            <div class="markdown" innerHTML={unsafeHTML(markdownHtml(comment.body))} />
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

    const editTrigger = <EditTask.Trigger tone="neutral">Edit</EditTask.Trigger>
    const editDialog = (
      <EditTask.Dialog title={`Edit task ${showId(task.id)}`}>
        <EditTaskForm
          project={project}
          task={task}
          values={valuesOf(task)}
          edit={capabilities.edit}
          issues={[]}
          close={<EditTask.Close tone="ghost">Cancel</EditTask.Close>}
        />
      </EditTask.Dialog>
    )

    const canMove = task.status === "open" && capabilities.reorder
    const moveTrigger = canMove ? <MoveTask.Trigger tone="neutral">Move</MoveTask.Trigger> : null
    const moveDialog = canMove ? (
      <MoveTask.Dialog title={`Move task ${showId(task.id)}`}>
        <MoveForm
          project={project}
          task={task}
          capabilities={capabilities}
          groups={groups}
          issues={[]}
          heading={false}
          close={<MoveTask.Close tone="ghost">Cancel</MoveTask.Close>}
        />
      </MoveTask.Dialog>
    ) : null

    const moveInline =
      canMove && moveIssues.length > 0 ? (
        <MoveForm
          project={project}
          task={task}
          capabilities={capabilities}
          groups={groups}
          issues={moveIssues}
          heading={true}
        />
      ) : null

    const dependents = detail.blocks.map((view) => view.task)
    const removeTrigger = capabilities.remove ? (
      <RemoveTask.Trigger tone="danger">Remove</RemoveTask.Trigger>
    ) : null

    const removeDialog = capabilities.remove ? (
      <RemoveTask.Dialog title={`Remove task ${showId(task.id)}`}>
        <p>
          Remove{" "}
          <a href={routes.project.tasks.show.href({ project, id: task.id })}>
            {showId(task.id)} {task.title}
          </a>{" "}
          for good? This deletes the task and its file; version control keeps the history.
        </p>
        {dependents.length === 0 ? null : (
          <>
            <p class="warning">
              These open tasks depend on it and will be left with an unknown dependency:
            </p>
            <ul>
              {dependents.map((dep) => (
                <li key={dep.id}>
                  <a href={routes.project.tasks.show.href({ project, id: dep.id })}>
                    {showId(dep.id)} {dep.title}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        <form
          class="actions confirm"
          method="post"
          action={routes.project.tasks.remove.href({ project, id: task.id })}
        >
          {dependents.length === 0 ? null : <input type="hidden" name="force" value="1" />}
          <Button tone="danger" type="submit">
            {dependents.length === 0 ? "Remove" : "Remove anyway"}
          </Button>
          <RemoveTask.Close tone="ghost">Cancel</RemoveTask.Close>
        </form>
      </RemoveTask.Dialog>
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
            {editTrigger}
            {moveTrigger}
            {removeTrigger}
          </div>
        </div>
        {editDialog}
        {moveDialog}
        {removeDialog}
        {metadata(task, detail.view.state)}
        {task.description === "" ? null : (
          <section>
            <Heading level={2}>Description</Heading>
            <div class="markdown" innerHTML={unsafeHTML(markdownHtml(task.description))} />
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
        {moveInline}
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

export interface EditTaskFormProps {
  readonly project: string
  readonly task: Pick<Task, "id">
  readonly values: EditValues
  /** The store's `edit` capability: without it only the title and tags are offered. */
  readonly edit: boolean
  readonly issues?: ReadonlyArray<string> | undefined
  readonly close?: RemixNode | undefined
}

export function EditTaskForm(handle: Handle<EditTaskFormProps>) {
  return () => {
    const { project, task, values, edit, issues = [], close } = handle.props

    return (
      <>
        {issueList(issues)}
        <form
          class="edit-form"
          method="post"
          action={routes.project.tasks.update.href({ project, id: task.id })}
        >
          <Field label="Title" name="title" value={values.title} required />
          {edit ? (
            <Field
              control="textarea"
              label="Description"
              name="description"
              value={values.description}
            />
          ) : null}
          <Field label="Tags" name="tags" value={values.tags} />
          {edit ? (
            <>
              <Field label="Assignee" name="assignee" value={values.assignee} />
              <Field label="Depends on" name="dependsOn" value={values.dependsOn} />
            </>
          ) : null}
          <div class="actions">
            <Button tone="primary" type="submit">
              Save
            </Button>
            {close}
          </div>
        </form>
      </>
    )
  }
}

export interface EditTaskPageProps {
  readonly project: string
  readonly task: Pick<Task, "id">
  readonly values: EditValues
  readonly edit: boolean
  readonly issues?: ReadonlyArray<string> | undefined
}

export function EditTaskPage(handle: Handle<EditTaskPageProps>) {
  return () => {
    const { project, task, values, edit, issues = [] } = handle.props

    return (
      <>
        <Heading level={1}>Edit task {showId(task.id)}</Heading>
        <EditTaskForm
          project={project}
          task={task}
          values={values}
          edit={edit}
          issues={issues}
          close={
            <LinkButton
              tone="neutral"
              href={routes.project.tasks.show.href({ project, id: task.id })}
            >
              Cancel
            </LinkButton>
          }
        />
      </>
    )
  }
}
