---
title: Add the web dashboard and project management
tags: [web, hub]
depends_on: [17]
---
## Goal

Make the web app the place to see every project: a dashboard at `/` with
filters, sync controls, a project switcher, and pages to add, rename and
remove projects.

Design: [hub design §6, Web](../../docs/superpowers/specs/2026-09-13-hub-design.md#web).
Visual language: [web app design, Visual design](../../docs/superpowers/specs/2026-09-12-web-app-design.md#visual-design)
(document-like, hairlines, semantic pastels; reuse `app/ui/styles.css`).

## Scope

In: `GET /`, `/projects` pages and forms, `POST /sync`,
`POST /p/:project/sync`, the header switcher, live refresh of the
dashboard.

Out: new sources (19, 06 wire theirs); a progress UI for clones.

## Design

**Dashboard (`GET /`)** from `hub.overview(query)` and `hub.projects()`:

- Query parameters → `OverviewQuery`: `project` (repeatable), `source`
  (repeatable), `tag` (repeatable), `assignee`, `state` (`ready` |
  `blocked`), `view` (`projects` default | `flat`). Invalid values → 400.
- `view=projects`: one section per project in registry order: name (links
  to `/p/:project`), a source badge (`fs`, `git`, `jira`), sync status
  (`synced 3h ago`, `never synced`, `error: …`, `ahead 1`, `diverged`;
  only for syncable projects), counts (open, ready, blocked), and the first
  five ready tasks (qualified IDs, linking to their task pages). An error
  entry shows the error in the error pastel, with a link to the project
  page and a **Sync** button.
- `view=flat`: every matching task across projects in one list, qualified
  IDs, project chip, state badge; same row component as the board where
  possible.
- A filter bar (a GET form, so it works without JS) with project and source
  checkboxes, tag and assignee inputs, state select, view toggle.
- **Sync all** (`POST /sync`) button; shows only when some project is
  syncable.
- Empty registry: a sentence and a link to `/projects` ("No projects yet.
  Add one."). An unregistered startup project is listed first with a
  `not registered` note and a **Register** button.

**Projects (`/projects`)**:

| Route | Behavior |
| --- | --- |
| `GET /projects` | Table: name, source, location, status; per row **Sync**, **Rename** (inline form), **Remove**. An add form: target (path or URL), optional name, source select (the loaded sources' kinds, default "infer"). |
| `POST /projects` | `projectInput` + `hub.add`; 303 to `/p/:name` with a flash; errors (invalid name, duplicate, config, prepare failure) → 422 with the form and message. Adding a git project clones synchronously. |
| `POST /projects/:name/rename` | `hub.rename`, 303 to `/projects`, flash. |
| `POST /projects/:name/remove` | `hub.remove(name, { force })`; a `beforeRemove` refusal (git with unpushed commits) → 422 explaining it, with a **Remove anyway** form that sends `force=1`. |

**Sync**: `POST /sync` → `hub.syncAll()`, 303 back (a `back` field, as the
complete form does) with a flash summarizing (`2 synced, 1 failed: work
(auth)`). `POST /p/:project/sync` → `hub.sync`, 303 back, flash with the
summary or error.

**Header**: a project switcher (a `<select>` in a GET form to a small
`GET /go?project=` redirect, so it works without JS; the entry script can
submit on change), links to Dashboard and Projects, the current project's
Board/Done/Check links when inside a project.

**Live refresh**: the dashboard's live region refreshes on any `changed`,
`synced` or `registry` event; `/projects` on `registry` and `synced`.
Reuse the dirty-form rule from `refreshDecision`.

**Controllers**: `app/actions/dashboard/controller.tsx`,
`app/actions/projects/controller.tsx`; UI pieces in `app/ui/`
(`dashboard.tsx`, `projects.tsx`, `status.tsx` for the sync-status badge,
shared with the board header).

## Files

- `apps/web/app/routes.ts`, `app/router.ts`, new controllers and UI files,
  `app/ui/document.tsx`, `app/ui/styles.css`, `app/actions/public/entry.ts`
- `apps/web/test/dashboard.test.ts`, `projects.test.ts` (new)
- `apps/web/README.md`

## Tests

Router tests over a hub with `memorySource` projects in a temporary home:

- Dashboard lists projects in registry order with counts and next tasks;
  each filter parameter narrows results; `view=flat` shows qualified IDs;
  invalid `state` → 400; a project whose `open` fails shows an error entry
  and the others still render.
- Sync status rendering for never/ok/error/ahead/diverged.
- `POST /projects` success → 303 and registry updated; duplicate name →
  422 with the form; `rename`; `remove` refused → 422 with the force form;
  forced remove works.
- `POST /sync` and `POST /p/:project/sync` → 303 with the flash summary;
  a failing sync shows its reason.
- Switcher redirect; Register button for an unregistered startup project.
- Security: the new POST routes are covered by the cross-origin test.

## Docs

- `apps/web/README.md` (routes), `docs/architecture/frontends.md`
  (drop "Planned (tasks 17, 18)"), root `README.md` "Using the web app".

## Done when

- From the browser you can see all projects, filter across them, sync, and
  add, rename and remove projects.
- Every page and form works without JavaScript.
- `bun run check` passes.
