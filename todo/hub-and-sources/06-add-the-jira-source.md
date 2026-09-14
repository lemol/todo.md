---
title: Add the Jira source
tags: [adapter, hub]
depends_on: [13, 15]
---
## Goal

See and act on your Jira tickets next to your repositories' todos: a
project backed by a JQL query (default: assigned to me, not done), mirrored
locally on `sync`, with complete, reopen, comment and title/label edits
going straight to Jira.

Design: [hub design §4, jira](../../docs/superpowers/specs/2026-09-13-hub-design.md#jira-srcjira-lemoltodo-mdjira),
[docs/architecture/sources.md](../../docs/architecture/sources.md).

## Scope

In: `src/jira` (`@lemol/todo-md/jira`) exporting `jiraSource`; the mirror;
ADF → Markdown; mutations for complete, reopen, comment, update (title,
tags); wiring into the CLI and web; `todo projects add --source jira`
flags.

Out: creating or deleting issues (`add`/`remove` capabilities absent);
Markdown → ADF beyond plain paragraphs; editing description, assignee or
links; Jira Server/Data Center (Cloud REST v3 only); OAuth.

## Design

**Config** (Schema): `{ site, email, token_env?, token_command?, jql?,
done_jql?, done_transition?, reopen_transition? }`; exactly one of
`token_env`/`token_command`. No `defaultName`: `--name` is required.
`location`: the site.

**Token**: `token_env` → that environment variable (the source is given
`env` at construction); `token_command` → run through `ChildProcess`, stdout
trimmed. Resolved per operation, never stored or logged. Missing →
`SyncError` `auth` / `StoreError`.

**HTTP** (`src/jira/client.ts`): `HttpClient` with base URL
`<site>/rest/api/3`, basic auth `email:token`, JSON. Endpoints:

| Use | Endpoint |
| --- | --- |
| check credentials (`prepare`) | `GET /myself` |
| search (paginated with `nextPageToken`) | `GET /search/jql?jql=…&fields=…&nextPageToken=…` |
| one issue | `GET /issue/{key}?fields=…` |
| comments (when the issue's embedded page is truncated) | `GET /issue/{key}/comment` |
| transitions | `GET /issue/{key}/transitions`, `POST /issue/{key}/transitions` |
| comment | `POST /issue/{key}/comment` |
| edit | `PUT /issue/{key}` (`summary`, `labels`) |

Fields: `summary, description, labels, assignee, status, priority,
issuelinks, resolutiondate, comment, project`. Verify endpoint shapes
against Atlassian's current REST v3 docs before coding; the fake server in
tests must mirror them.

**Error mapping**: network failure → `offline`; 401/403 → `auth`; 429 →
`remote` with `Retry-After` in the message; other non-2xx → `remote` with
Jira's `errorMessages`. In store operations the same map to `StoreError`
with that message; 404 on `get` → `TaskNotFound`.

**Queries**: `jql` default `assignee = currentUser() AND statusCategory !=
Done`; `done_jql` default `assignee = currentUser() AND statusCategory =
Done AND resolved >= -30d`. Append ` ORDER BY Rank ASC` to `jql` and
` ORDER BY resolved DESC` to `done_jql` when they have no `ORDER BY`.

**Mirror** (`<dir>/mirror.json`, written atomically):
`{ version: 1, syncedAt, open: Task[], done: Task[] }`, tasks in the
model's encoded form (`Task` schema from `spec`). **`prepare`** = `GET
/myself` then a first `sync`. **`sync`** fetches both queries fully, maps,
writes; summary `12 open, 5 done`.

**Mapping** (`src/jira/mapping.ts`, pure):

| Model | From |
| --- | --- |
| `id` | `key` |
| `title` | `fields.summary` |
| `description` | `fields.description` via ADF → Markdown |
| `status` | `done` when `status.statusCategory.key === "done"`, else `open` |
| `tags` | `fields.labels` |
| `assignee` | slug of `assignee.displayName` (lowercase, runs of non-alphanumerics → `-`) |
| `dependsOn` | keys of `issuelinks` of type "Blocks" where this issue is blocked (the `inwardIssue` of a "Blocks" link seen from the blocked issue; verify direction against real payloads) |
| `comments` | newest first; `author` = slug of `author.displayName`, `at` = `created`, `body` = ADF → Markdown |
| `completedAt` | `resolutiondate` for done issues |
| `group` | absent |
| `extra` | `status` (name), `priority` (name), `url` (`<site>/browse/<key>`), `project` (key), `assignee_name`, `assignee_account` |

**ADF → Markdown** (`src/jira/adf.ts`, pure, no dependencies): `doc`,
`paragraph`, `text` with marks (`strong`, `em`, `code`, `strike`, `link`),
`heading`, `bulletList`, `orderedList`, `listItem`, `codeBlock` (with
language), `blockquote`, `rule`, `hardBreak`, `mention` (`@name`), `emoji`
(its text), `inlineCard`/`blockCard` (a link), `taskList`/`taskItem`
(`- [ ]`/`- [x]`), `table` (GFM table; cells flattened to one line),
`panel` (a blockquote), `media`/`mediaSingle` (`[attachment]`). Unknown
nodes render their text content. Headings are shifted so comment bodies
never contain levels 1–3 (spec §2.6): add 3 levels in comments, capped at 6.

**Store** (`src/jira/store.ts`), capabilities `{ comments: true }`, all
others false:

- `load` → `{ title: <project name>, description: "", ungrouped: open,
  groups: [] }`; `listDone` → `done`; missing mirror → `StoreError` ("not
  synced; run `todo sync <name>`").
- `get(id)`: from the mirror, else a live `GET /issue/{key}` (not written
  to the mirror).
- `complete(id)`: already done → `InvalidTransition`. Pick the transition
  named `done_transition`, else the first whose `to.statusCategory.key` is
  `done`; none → `StoreError` naming the available transitions. `POST`,
  then re-fetch the issue and move it from `open` to `done` in the mirror.
- `reopen(id)`: not done → `InvalidTransition`; `reopen_transition`, else
  the first transition into category `new`; then re-fetch as above.
- `comment(id, { body })`: `POST` with the body as ADF paragraphs (split on
  blank lines; text only). Returns the created comment mapped back;
  re-fetch the issue into the mirror. The Jira user is the author;
  `input.author` is ignored (documented).
- `update(id, patch)`: `title` → `summary`, `tags` → `labels` via `PUT`.
  Any of `description`, `assignee`, `dependsOn`, `extra` in the patch →
  `ValidationError` ("<field> is read-only for Jira projects"). Re-fetch.
- `add`, `remove`, `move`, `renameGroup` → `Unsupported` (core guards them
  first).
- `diagnostics` → `[]`.
- Mirror patches after a mutation re-read the mirror file under
  `makeLock(dir)` and write it atomically.

**`changes`**: watch `<dir>/mirror.json`. **`status`**: nothing beyond the
hub's state.

**Wiring.** `src/cli/bin.ts` and `src/web/server.ts` add
`JiraSource.make({ env })` (needing `HttpClient` via `FetchHttpClient` and
`ChildProcessSpawner`). `todo projects add <site> --source jira --name
<n> --email <e> (--token-env <VAR> | --token-command <cmd>) [--jql <q>]`,
with descriptions and examples; the web add form gets the same fields
when the source select is `jira`.

## Files

- New: `src/jira/index.ts`, `JiraSource.ts`, `client.ts`, `mapping.ts`,
  `adf.ts`, `store.ts`, `mirror.ts`, `errors.ts`, `README.md`
- `package.json` exports `"./jira"`
- `test/boundaries.test.ts`: `jira: { modules: ["spec", "hub"],
  packages: ["effect"] }` + checker cases; web may import
  `@lemol/todo-md/jira`
- `src/cli/bin.ts`, `src/cli/commands/projects.ts`, `src/web/server.ts`,
  web projects form
- `test/jira/*.test.ts`, `test/jira/fixtures/*.json` (ADF and issue
  payloads)

## Tests

- A fake Jira: an in-memory issue table behind an `HttpClient` test layer
  (`HttpClient.make` answering the endpoints above), with transitions per
  status and a switch to return 401/429/network errors.
- `runConformance("jira", layer, { seed })`, where `seed` inserts issues
  into the fake and syncs (task 13's `seed`). Cases requiring `add`,
  `remove`, `groups`, `reorder` or `renameGroup` are skipped.
- Golden ADF → Markdown tests per node type, plus a real-world payload.
- Mapping: labels, links → `dependsOn`, comments order and author slugs,
  `extra`.
- Transition choice: by name, by category, none available.
- `update` with a read-only field → `ValidationError`, nothing sent.
- Sync: pagination across pages; `ORDER BY` appended only when missing;
  401 → `auth`; 429 → `remote` with retry-after; network → `offline`;
  mirror untouched on failure.
- Token: from env; from a command (test spawner); missing → `auth`.
- CLI e2e: `projects add --source jira …` against the fake (inject the
  client layer through the CLI's test context).

## Docs

- `src/jira/README.md` (config, capabilities, limits, token setup, e.g.
  macOS Keychain with `token_command: security find-generic-password -s
  jira -w`); `docs/architecture/sources.md` jira section; module table row;
  root `README.md` package table.

## Done when

- A Jira project shows your tickets in `todo --project work`, `todo ls
  --all` and the web dashboard after `todo sync`, and complete, reopen,
  comment and title/label edits reach Jira.
- `bun run check` passes, with no network access in tests.
