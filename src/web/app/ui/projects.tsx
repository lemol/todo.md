/** @jsxImportSource remix/ui */

import { EmptyState } from "@lemol/ui/mini"
import {
  Badge,
  Button,
  Field,
  Heading,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
} from "@lemol/ui/remix"
import type { DateTime } from "effect"
import type { Handle, RemixNode } from "remix/ui"
import type { ProjectInfo } from "../../../hub/index.ts"
import type { ProjectValues } from "../actions/forms.ts"
import { routes } from "../routes.ts"
import { syncStatusBadge } from "./status.tsx"

export interface ProjectsOptions {
  readonly projects: ReadonlyArray<ProjectInfo>
  /** The kinds the hub loaded, for the add form's source select. */
  readonly sources: ReadonlyArray<string>
  readonly now: DateTime.Utc
  readonly values?: ProjectValues | undefined
  readonly issues?: ReadonlyArray<string> | undefined
  /** A project whose removal the source refused, with the reason. */
  readonly refusal?: { readonly name: string; readonly message: string } | undefined
  /** The project whose inline rename form is open. */
  readonly renaming?: string | undefined
}

const row = (info: ProjectInfo, now: DateTime.Utc, renaming: string | undefined): RemixNode => {
  const name = info.name
  const rename =
    renaming === info.name ? (
      <form method="post" action={routes.projects.rename.href({ name: info.name })} class="inline">
        <input name="to" value={name} aria-label={`New name for ${name}`} required />
        <button type="submit">Save</button>
      </form>
    ) : (
      <a
        class="secondary"
        href={`${routes.projects.index.href()}?rename=${encodeURIComponent(info.name)}`}
      >
        Rename
      </a>
    )
  const sync = info.syncable ? (
    <form method="post" action={routes.project.sync.href({ project: info.name })} class="inline">
      <input type="hidden" name="back" value={routes.projects.index.href()} />
      <button class="secondary" type="submit">
        Sync
      </button>
    </form>
  ) : null

  return (
    <TableRow key={info.name}>
      <TableCell>
        <a href={routes.project.board.href({ project: info.name })}>{name}</a>
        {info.registered ? null : (
          <>
            {" "}
            <Badge tone="warning">not registered</Badge>
          </>
        )}
      </TableCell>
      <TableCell>
        <Badge tone="neutral">{info.source}</Badge>
      </TableCell>
      <TableCell>
        <code>{info.location}</code>
      </TableCell>
      <TableCell>
        {info.syncable ? (
          syncStatusBadge(info.status, now)
        ) : (
          <Text as="span" tone="muted">
            —
          </Text>
        )}
      </TableCell>
      <TableCell>
        {sync}
        {rename}
        <form
          method="post"
          action={routes.projects.remove.href({ name: info.name })}
          class="inline"
        >
          <button class="secondary danger" type="submit">
            Remove
          </button>
        </form>
      </TableCell>
    </TableRow>
  )
}

const addForm = (options: ProjectsOptions): RemixNode => {
  const values = options.values ?? {
    target: "",
    name: "",
    source: undefined,
    branch: "",
    list: "",
    issues: [],
  }
  const issues = options.issues ?? []
  const sources = ["infer", ...options.sources]

  return (
    <section class="add-project">
      <Heading level={2}>Add a project</Heading>
      {issues.length === 0 ? null : (
        <ul class="issues">
          {issues.map((issue) => (
            <li class="badge error" key={issue}>
              {issue}
            </li>
          ))}
        </ul>
      )}
      <form method="post" action={routes.projects.add.href()}>
        <Field
          label="Target"
          name="target"
          value={values.target}
          placeholder="~/labs/acme or https://github.com/owner/repo.git"
          required
        />
        <Field label="Name" name="name" value={values.name} placeholder="optional" />
        <Field control="select" label="Source" name="source">
          {sources.map((kind) => (
            <option
              value={kind}
              key={kind}
              {...((values.source ?? "infer") === kind ? { selected: true } : {})}
            >
              {kind}
            </option>
          ))}
        </Field>
        <fieldset class="git-only">
          <legend>git only</legend>
          <Field
            label="Branch"
            name="branch"
            value={values.branch}
            placeholder="the repository's own"
          />
          <Field
            label="List"
            name="list"
            value={values.list}
            placeholder="todo/ or the repository root"
          />
        </fieldset>
        <Button tone="primary" type="submit">
          Add
        </Button>
      </form>
    </section>
  )
}

const refusal = (options: ProjectsOptions): RemixNode => {
  if (options.refusal === undefined) return null
  const { name, message } = options.refusal
  return (
    <section class="project-error">
      <p class="badge error">{message}</p>
      <form method="post" action={routes.projects.remove.href({ name })} class="inline">
        <input type="hidden" name="force" value="1" />
        <button class="secondary danger" type="submit">
          Remove anyway
        </button>
      </form>
    </section>
  )
}

export function ProjectsPage(handle: Handle<ProjectsOptions>) {
  return () => {
    const options = handle.props
    const table =
      options.projects.length === 0 ? (
        <EmptyState title="No projects yet." description="Add one below." />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Location</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {options.projects.map((info) => row(info, options.now, options.renaming))}
          </TableBody>
        </Table>
      )

    return (
      <Stack gap={6}>
        <Heading level={1}>Projects</Heading>
        {refusal(options)}
        {table}
        {addForm(options)}
      </Stack>
    )
  }
}
