---
title: Write to Jira from a Jira project
tags: [adapter, hub]
group: Hub and sources
completed_at: 2026-09-25T21:40:10Z
outcome: completed
---
## Goal

Act on a Jira ticket from here, not just read it: complete, reopen, comment,
and edit the title and labels, each going straight to Jira and then back into
the mirror.

Task 06 built the reading half (`src/jira`: the client, ADF → Markdown, the
mapping, the mirror, sync, and a read-only store wired into the CLI). This is
the rest of it.

Design: [hub design §4, jira](../../docs/superpowers/specs/2026-09-13-hub-design.md#jira-srcjira-lemoltodo-mdjira),
[src/jira/README.md](../../src/jira/README.md).

## Scope

In: the mutating half of `src/jira/store.ts`; the write endpoints in
`src/jira/client.ts`; Markdown → ADF paragraphs; the `comments` capability;
`runConformance`; wiring the source into `src/web`.

Out: everything task 06 put out of scope — creating or deleting issues
(`add`/`remove` stay absent), ADF beyond plain paragraphs, editing the
description, assignee or links, Jira Server/Data Center, OAuth.

## Design

**Capabilities** become `{ comments: true }`, all others false.

**Client** gains `GET /issue/{key}/transitions`, `POST
/issue/{key}/transitions`, `POST /issue/{key}/comment` and `PUT /issue/{key}`
(`summary`, `labels`). The existing error map already covers them; a 404 on a
mutation is `TaskNotFound`.

**Store**

- `complete(id)`: already done → `InvalidTransition`. Pick the transition
  named `done_transition`, else the first whose `to.statusCategory.key` is
  `done`; none → `StoreError` naming the transitions that are available.
- `reopen(id)`: not done → `InvalidTransition`; `reopen_transition`, else the
  first transition into category `new`.
- `comment(id, { body })`: `POST` the body as ADF paragraphs, split on blank
  lines, text only. Returns the created comment mapped back. The Jira user is
  the author; `input.author` is ignored, and that is documented.
- `update(id, patch)`: `title` → `summary`, `tags` → `labels`. Any of
  `description`, `assignee`, `dependsOn` or `extra` in the patch →
  `ValidationError` ("<field> is read-only for Jira projects"), with nothing
  sent.
- Each of them re-fetches the issue afterwards and patches it into the
  mirror, moving it between `open` and `done` as its status now says.

**Mirror patches** re-read `mirror.json` and write it atomically, so a sync
running alongside cannot lose the change. Note that `jira` may not import
`fs`, where `makeLock` lives (`test/boundaries.test.ts`): either serialize
another way or move the lock somewhere both modules may use, and update the
architecture doc and the boundaries test together.

**Wiring.** `src/web/server.ts` builds `JiraSource.make({ env })`, and the web
projects form gets the site, email, token and jql fields when the source
select is `jira`. `test/boundaries.test.ts` adds `jira` to `webModules`.

## Files

- `src/jira/client.ts`, `store.ts`, `mapping.ts` (Markdown → ADF), `README.md`
- `src/web/server.ts` and the web projects form; `test/boundaries.test.ts`
- `test/jira/conformance.test.ts`, and the existing `test/jira/*.test.ts`
- `docs/architecture/sources.md`, `docs/architecture/README.md`, root
  `README.md`: drop the "reading only" notes

## Tests

- `test/jira/fake.ts` grows transitions per status, comment creation and
  issue edits; it already mirrors the REST v3 shapes.
- `runConformance("jira", layer, { seed })`, where `seed` inserts issues into
  the fake and syncs. Cases needing `add`, `remove`, `groups`, `reorder` or
  `renameGroup` are skipped; the read-only placeholders in
  `test/jira/store.test.ts` ("the Jira store: writing") come out.
- Transition choice: by name, by category, and none available.
- `update` with a read-only field → `ValidationError`, and the fake saw no
  request.
- `comment` splits a body on blank lines into ADF paragraphs, and the author
  is the Jira user whatever `input.author` said.
- After each mutation the mirror holds the re-fetched issue, on the right
  side of open/done.
- CLI e2e: `todo done`, `todo reopen`, `todo comment` and `todo edit` against
  the fake.

## Done when

- `todo done work:PROJ-1`, `todo reopen`, `todo comment` and `todo edit
  --title/--tag` reach Jira and show the new state straight afterwards.
- The web dashboard lists a Jira project and can add one.
- `runConformance("jira", …)` passes, and `bun run check` passes with no
  network access in tests.
