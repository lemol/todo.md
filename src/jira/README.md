# jira

`@lemol/todo-md/jira`. Your Jira tickets as a hub project: the issues two JQL
queries return, mirrored into one JSON file and read from there.

> **Status: built** (tasks 06 and 24). `todo sync`, `ls`, `next` and `show`
> read the mirror; `todo done`, `reopen`, `comment` and `edit --title/--tag`
> go straight to Jira and back into the mirror. The web app lists, adds and
> edits Jira projects the same way.

The behavior is specified in the
[hub design, §4 jira](../../docs/superpowers/specs/2026-09-13-hub-design.md#jira-srcjira-lemoltodo-mdjira);
[docs/architecture/sources.md](../../docs/architecture/sources.md) puts it next
to the other sources.

## Building it

`jiraSource` speaks HTTP and may run a command to fetch a token, so it is
built where an `HttpClient` and a `ChildProcessSpawner` are available and
passed to the hub as a plain value:

```ts
const jiraSource = yield* JiraSource.make({ env: process.env }).pipe(
  Effect.provide(FetchHttpClient.layer),
)
Hub.layer({ home, userHome, sources: [fsSource, gitSource, jiraSource] })
```

`env` is read for one thing: the variable a project's `token_env` names.

## Config

```yaml
projects:
  work:
    source: jira
    site: https://acme.atlassian.net
    email: me@acme.test
    token_env: JIRA_TOKEN     # exactly one of token_env and token_command
    jql: project = PROJ AND statusCategory != Done   # optional
    done_jql: project = PROJ AND statusCategory = Done AND resolved >= -14d
```

A project **needs a name**: one site holds every project, so there is nothing
to derive one from.

| Key | What it is |
| --- | --- |
| `site` | The Jira Cloud site, e.g. `https://acme.atlassian.net`. Also the project's location |
| `email` | The account the API token belongs to; basic auth is `email:token` |
| `token_env` | The environment variable holding the API token |
| `token_command` | A command printing the API token, run through a shell |
| `jql` | The open issues (default: `assignee = currentUser() AND statusCategory != Done`) |
| `done_jql` | The done ones (default: the same, `statusCategory = Done AND resolved >= -30d`) |
| `done_transition` | The transition `complete` takes (default: the first into the done category) |
| `reopen_transition` | The transition `reopen` takes (default: the first into the to-do category) |
| `read_only` | `true` never writes to Jira (see below); `--read-only` on `todo projects add` |

`ORDER BY Rank ASC` is appended to `jql`, and `ORDER BY resolved DESC` to
`done_jql`, when the query has no order of its own.

### The token

The token is resolved for every call and never written anywhere: not to the
registry, not to the mirror, not into an error message. On macOS, keeping it
in the keychain rather than in your shell profile:

```sh
security add-generic-password -s jira -a me@acme.test -w   # once, prompts
todo projects add https://acme.atlassian.net --source jira --name work \
  --email me@acme.test \
  --token-command 'security find-generic-password -s jira -w'
```

## Layout

```
<home>/projects/<name>/
  mirror.json   { version, syncedAt, open: Task[], done: Task[], patched? }
  .todo.lock    held while mirror.json is written
  state.json    the hub's, not ours
```

## Files

| File | What it holds |
| --- | --- |
| `client.ts` | REST v3 over `HttpClient`: `/myself`, `/search/jql`, `/issue/{key}` (GET and PUT), comments, transitions; the token; HTTP failures as `JiraError` |
| `mapping.ts` | The shape of Jira's payloads, an issue as a `Task`, and Markdown → ADF paragraphs |
| `adf.ts` | Atlassian Document Format → Markdown, pure and dependency-free |
| `mirror.ts` | `mirror.json`: read, replace after a sync, and patch one issue after a mutation, atomically and under the lock |
| `store.ts` | The `TodoStore`: reads from the mirror, mutations through Jira |
| `JiraSource.ts` | `JiraConfig` and the `Source`: prepare, open, sync, changes |
| `errors.ts` | `JiraError`, and how it reads as a `SyncError` or a `StoreError` |

## What sync does

`GET /search/jql` for each query, following `nextPageToken` to the end, then
one `mirror.json` written atomically. An issue whose embedded comment page was
truncated costs one more request, so the mirror holds every comment and later
reads cost none. The summary is `12 open, 5 done`.

`prepare` (on `todo projects add`) checks the credentials with `GET /myself`
and then syncs; a site that refuses them registers nothing.

**The mirror is replaced only once both queries have succeeded**, so a failed
sync leaves the last good one in place and the list still opens.

## Mutations

The store declares `comments` and no other capability (spec §1.5). Each
mutation goes to Jira, re-fetches the issue and patches it into the mirror,
on the open or done side as its status now says, so `todo ls` shows the
change straight away without a sync.

| Operation | Jira |
| --- | --- |
| `complete` | `POST /issue/{key}/transitions`: `done_transition` by name, else the first transition into the `done` category. None → `StoreError` naming the ones available. A done issue → `InvalidTransition`, nothing sent |
| `reopen` | the same with `reopen_transition`, else the first into `new` (To Do) |
| `comment` | `POST /issue/{key}/comment`, the body as ADF paragraphs split on blank lines, text only. **The Jira user is the author**: `input.author` is validated, then ignored (no `commentAuthor`) |
| `update` | `PUT /issue/{key}`: `title` → `summary`, `tags` → `labels`. Jira keeps the rest (no `edit`): `description`, `assignee`, `dependsOn` or `extra` in a patch fails with `ValidationError` ("… is read-only for Jira projects") and nothing is sent |

**`read_only: true`** is for a site whose workflow is not yours to drive. The
project reads and syncs as usual, but `complete`, `reopen` and `update` fail
with a `StoreError` ("work is read-only (read_only in its registry entry);
change PROJ-1 in Jira") before any request is sent, and the store drops
`comments`, so `comment` is `Unsupported` and frontends hide it. Nothing is
kept locally to push later: a change is made in Jira, then synced.

**A sync running alongside cannot lose a mutation.** Patches and syncs both
write under `<dir>/.todo.lock`, re-reading the mirror first. A patch records
when it happened in `patched`; a sync that started before then fetched the
issue before the change, so it keeps the patched copy instead of its own.

## Mapping

| Model | Jira |
| --- | --- |
| `id` | the issue key |
| `title` | `summary`, on one line; the key when it is blank |
| `description` | `description`, ADF → Markdown |
| `status` | `done` when the status category is `done`, else `open` |
| `tags` | `labels` |
| `assignee` | the assignee's display name as a handle (`Ana Silva` → `ana-silva`) |
| `dependsOn` | the issues blocking this one: a `Blocks` link with this issue on the inward end |
| `comments` | newest first; the body's headings pushed 3 levels down (spec §2.6) |
| `completedAt` | `resolutiondate`, on a done issue |
| `outcome` | `completed` on a done issue; Jira has nothing to map `cancelled` from |
| `group` | never: Jira has no groups |
| `extra` | `status`, `priority`, `url`, `project`, `assignee_name`, `assignee_account` |

Anything Jira did not send is simply absent; a payload this version does not
understand is a `remote` failure, never a crash.

## Errors

| What happened | Sync | Operation |
| --- | --- | --- |
| The network never answered | `offline` | `StoreError` |
| 401 or 403 | `auth` | `StoreError` |
| 429 | `remote`, with the retry-after | `StoreError` |
| Any other non-2xx | `remote`, with Jira's `errorMessages` | `StoreError` |
| 404 on one issue, reading or writing | `remote` | `TaskNotFound` |

## What it does not do

No issue is ever created or deleted from here (`add` and `remove` are absent,
spec §1.5). No groups, no reordering, no cancelling, no editing the
description, assignee or links, and no ADF beyond plain paragraphs. No Jira
Server or Data Center (Cloud REST v3 only), and no OAuth.
