/** @jsxImportSource remix/component */

import { EmptyState } from "@lemol/ui/mini"
import { Badge, type BadgeTone, Heading, Stack, Text } from "@lemol/ui/remix"
import type { Handle } from "remix/component"
import type { TaskView } from "../../../core/index.ts"
import type { Diagnostic } from "../../../spec/index.ts"
import { routes } from "../routes.ts"
import { formatDate, showId } from "./format.ts"

export interface DonePageProps {
  readonly project: string
  readonly tasks: ReadonlyArray<TaskView>
}

export function DonePage(handle: Handle<DonePageProps>) {
  return () => {
    const { project, tasks } = handle.props

    if (tasks.length === 0) {
      return (
        <Stack gap={4}>
          <Heading level={1}>Done</Heading>
          <EmptyState title="Nothing done." />
        </Stack>
      )
    }

    return (
      <Stack gap={4}>
        <Heading level={1}>Done</Heading>
        {tasks.map(({ task }) => {
          const group = task.group === undefined ? "Ungrouped" : task.group
          // Absent `outcome` on a done task means completed (spec §1.1): branch on
          // "cancelled" explicitly so every historical done task keeps reading as
          // completed.
          const outcome = task.outcome === "cancelled" ? "cancelled" : formatDate(task.completedAt)

          return (
            <article class="done-row" key={task.id}>
              <code>{showId(task.id)}</code>
              <a href={routes.project.tasks.show.href({ project, id: task.id })}>{task.title}</a>
              <span>
                <code>{outcome}</code> · {group}
              </span>
              <form
                method="post"
                action={routes.project.tasks.reopen.href({ project, id: task.id })}
              >
                <button class="secondary" type="submit">
                  Reopen
                </button>
              </form>
            </article>
          )
        })}
      </Stack>
    )
  }
}

const severities = ["error", "warning", "info"] as const

export interface CheckPageProps {
  readonly project: string
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

const badgeToneForSeverity = (severity: (typeof severities)[number]): BadgeTone =>
  severity === "error" ? "danger" : severity === "warning" ? "warning" : "info"

export function CheckPage(handle: Handle<CheckPageProps>) {
  return () => {
    const { project, diagnostics } = handle.props

    if (diagnostics.length === 0) {
      return (
        <Stack gap={4}>
          <Heading level={1}>Check</Heading>
          <Text tone="muted">No diagnostics.</Text>
        </Stack>
      )
    }

    return (
      <Stack gap={6}>
        <Heading level={1}>Check</Heading>
        {severities.flatMap((severity) => {
          const items = diagnostics.filter((item) => item.severity === severity)

          if (items.length === 0) return []

          const label = `${severity[0]?.toUpperCase()}${severity.slice(1)}s`

          return [
            <section key={severity}>
              <Stack gap={3}>
                <Heading level={2}>{label}</Heading>
                <ul class="diagnostics">
                  {items.map((item) => {
                    const task =
                      item.taskId === undefined ? null : (
                        <>
                          {" "}
                          <a href={routes.project.tasks.show.href({ project, id: item.taskId })}>
                            task {showId(item.taskId)}
                          </a>
                        </>
                      )

                    const location =
                      item.file === undefined ? null : (
                        <>
                          {" "}
                          <code>
                            {item.file}
                            {item.line === undefined ? "" : `:${item.line}`}
                          </code>
                        </>
                      )

                    return (
                      <li
                        key={`${item.code}-${item.taskId ?? ""}-${item.file ?? ""}-${item.line ?? ""}`}
                      >
                        <Badge tone={badgeToneForSeverity(severity)}>
                          {severity.toUpperCase()}
                        </Badge>{" "}
                        <code>{item.code}</code> {item.message}
                        {task}
                        {location}
                      </li>
                    )
                  })}
                </ul>
              </Stack>
            </section>,
          ]
        })}
      </Stack>
    )
  }
}
