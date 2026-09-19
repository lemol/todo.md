# jira

`@lemol/todo-md/jira`. Your Jira tickets as a hub project: the issues two JQL
queries return, mirrored into one JSON file and read from there.

> **Status: reading only.** `todo sync`, `todo ls`, `todo next` and `todo show`
> work against a Jira project. Complete, reopen, comment and editing the title
> or labels are the second half of task 06 and are not built yet; the store
> declares no capability and refuses every mutation.

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
| `done_transition`, `reopen_transition` | Transition names for the mutations; read but not used yet |

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
  mirror.json   { version, syncedAt, open: Task[], done: Task[] }
  state.json    the hub's, not ours
```

## Files

| File | What it holds |
| --- | --- |
| `client.ts` | REST v3 over `HttpClient`: `/myself`, `/search/jql`, `/issue/{key}`, comments; the token; HTTP failures as `JiraError` |
| `mapping.ts` | The shape of Jira's payloads, and an issue as a `Task` |
| `adf.ts` | Atlassian Document Format → Markdown, pure and dependency-free |
| `mirror.ts` | `mirror.json`: read, and replace atomically |
| `store.ts` | The `TodoStore` over the mirror |
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
| 404 on one issue | `remote` | `TaskNotFound` |

## What it does not do

No issue is ever created or deleted from here (`add` and `remove` are absent,
spec §1.5). No groups, no reordering, no Jira Server or Data Center (Cloud
REST v3 only), and no OAuth.
