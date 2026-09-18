# todo.md Specification

**Version:** 0.1 (draft) · **Status:** open for change until 1.0

todo.md is a standard for representing and managing tasks in a form that is
equally comfortable for humans and for agents. It has two parts:

- **Part 1: Model and operations.** An abstract description of lists,
  groups, tasks and the operations on them. Any backend (a directory of
  Markdown files, Jira, a database) can implement it.
- **Part 2: The todo.md format.** The canonical file-system representation,
  a `TODO.md` file plus one Markdown file per task. This is the reference
  representation, and the easiest way to understand the model.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## At a glance

```
todo/
├── TODO.md
├── 14-write-changelog.md
├── backend/
│   └── 07-add-rate-limiting.md
└── done/
    └── backend/
        └── 01-set-up-ci.md
```

```markdown
# Acme API

Backlog for the Acme public API.

- [ ] [14 - Write changelog](./14-write-changelog.md)

## Backend

- [ ] [07 - Add rate limiting](./backend/07-add-rate-limiting.md)
- [ ] 03 - Fix login redirect
  #bug @lemol depends_on:1
  Users land on /home instead of the page they requested.
```

Open tasks live in `TODO.md`, in priority order, under `##` groups. A task is
either written **inline** or **linked** to its own file. When a task is
completed it leaves `TODO.md` and its file moves to `done/`.

---

# Part 1: Model and operations

## 1.1 Entities

### TodoList

| Field         | Type      | Notes                                         |
| ------------- | --------- | --------------------------------------------- |
| `title`       | string    | May be empty.                                 |
| `description` | Markdown  | May be empty.                                 |
| `ungrouped`   | `Task[]`  | Open tasks that belong to no group, ordered.  |
| `groups`      | `Group[]` | Ordered.                                      |

A list contains only **open** tasks. Done tasks are reachable through `get` and
`listDone` (§1.3).

### Group

| Field         | Type     | Notes                                      |
| ------------- | -------- | ------------------------------------------ |
| `name`        | string   | Non-empty, single line, unique in the list. |
| `description` | Markdown | May be empty.                              |
| `tasks`       | `Task[]` | Open tasks, ordered.                       |

### Task

| Field         | Type                 | Notes                                                                     |
| ------------- | -------------------- | ------------------------------------------------------------------------- |
| `id`          | `TaskId`             | See §1.2.                                                                 |
| `title`       | string               | Non-empty, single line.                                                   |
| `description` | Markdown             | May be empty.                                                             |
| `status`      | `open` \| `done`     |                                                                           |
| `tags`        | string[]             | No duplicates; order is preserved.                                        |
| `assignee`    | string?              | At most one.                                                              |
| `dependsOn`   | `TaskId[]`           | Tasks that must be done before this one is ready.                         |
| `comments`    | `Comment[]`          | Newest first.                                                             |
| `group`       | string?              | Open: the containing group (absent if ungrouped). Done: the group at completion time. |
| `completedAt` | DateTime?            | Absent while open. Set by `complete`. MAY be absent on a done task whose completion time is unknown, such as one ticked by hand (§2.4) and not yet normalized. |
| `outcome`     | `completed` \| `cancelled` | Done tasks only. Absent on a done task means `completed`. |
| `cancelledReason` | string?          | Why the task was abandoned. Set by `cancel`. MAY be absent on a task cancelled by hand and not yet normalized. |
| `extra`       | map string → unknown | Fields this spec does not define. Implementations MUST preserve them.     |

### Comment

| Field    | Type     | Notes                                            |
| -------- | -------- | ------------------------------------------------ |
| `author` | string   | A handle: non-empty, no whitespace.              |
| `at`     | DateTime | Includes a UTC offset.                           |
| `body`   | Markdown | Non-empty.                                       |

## 1.2 Task identity

- A `TaskId` is an opaque, non-empty string. Each implementation defines its
  syntax. The file-system format uses decimal integers (`"7"`); a Jira adapter
  would use issue keys (`"PROJ-123"`).
- A `TaskId` MUST be unique within a list, across open and done tasks.
- A `TaskId` MUST NOT be reused, even after the task is removed, while any
  record of it remains in the list.
- The implementation assigns IDs, never the caller.

## 1.3 Derived state

These are computed, never stored:

- A dependency is **satisfied** when it refers to a task that is done with
  outcome `completed` (which includes every done task whose `outcome` is
  absent, per §2.6 — never test `outcome === "completed"` to mean this). A
  dependency on a cancelled task is unsatisfied, and it is also reported as a
  diagnostic (§1.6).
- A task is **ready** when it is open and all its dependencies are satisfied.
- A task is **blocked** when it is open and not ready. A dependency on an
  unknown ID is unsatisfied, and it is also reported as a validation error
  (§1.6).
- **Priority order** is document order: ungrouped tasks first, then each group
  in order, then tasks in order within the group. Higher means more
  important.
- **Next** means the ready tasks, in priority order.

## 1.4 Operations

Every implementation provides the operations below. "Placement" is
`{ group?, before?, after? }`:

- `group` names the target group. If absent, the target is ungrouped.
- `before` / `after` give an anchor task ID. The target group is the
  anchor's group; if `group` is also given and differs, the operation fails
  with `ValidationError`.
- Without an anchor, the task goes to the end of the target group.
- A `group` that does not exist is created at the end of the list.

| Operation                  | Semantics                                                                                                                                   | Errors                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `load()`                   | Returns the `TodoList` (open tasks only), in order.                                                                                         | `StoreError`                                            |
| `get(id)`                  | Returns one task, open or done.                                                                                                             | `TaskNotFound`                                          |
| `listDone()`               | Returns done tasks, most recently completed first.                                                                                          | `StoreError`                                            |
| `add(input, placement?)`   | Creates an open task and assigns its ID. `input` = `{ title, description?, tags?, assignee?, dependsOn?, extra? }`.                          | `ValidationError`, `TaskNotFound` (anchor)              |
| `update(id, patch)`        | Changes any of `title`, `description`, `tags`, `assignee` (null clears it), `dependsOn`, `extra`. Works on open and done tasks.              | `TaskNotFound`, `ValidationError`                       |
| `move(id, placement)`      | Reorders an open task or moves it to another group.                                                                                         | `TaskNotFound`, `InvalidTransition` (done), `Unsupported` |
| `complete(id)`             | open → done with outcome `completed`. Sets `completedAt` to now and records `group`. Completing a blocked task MUST be allowed; implementations MAY warn. | `TaskNotFound`, `InvalidTransition`                     |
| `cancel(id, reason)`       | open → done with outcome `cancelled`. Sets `completedAt` to now, records `group` and `cancelledReason`. Cancelling a blocked task MUST be allowed. | `TaskNotFound`, `InvalidTransition`, `ValidationError`, `Unsupported` |
| `reopen(id)`               | done → open. Clears `completedAt`, `outcome` and `cancelledReason`. The task goes to the end of its recorded group if that group exists, otherwise to the end of the ungrouped tasks. | `TaskNotFound`, `InvalidTransition`                     |
| `remove(id)`               | Permanently deletes an open or done task. Version control is the history.                                                                   | `TaskNotFound`                                          |
| `renameGroup(from, to)`    | Renames an open group. Done tasks keep the name recorded at completion.                                                                     | `GroupNotFound`, `ValidationError` (`to` exists), `Unsupported` |
| `comment(id, input)`       | Adds a comment `{ author, body }` with `at` = now, newest first. Works on open and done tasks.                                               | `TaskNotFound`, `ValidationError`, `Unsupported`        |
| `promote(id)`              | Gives the task its own document (§2.9), leaving what the task *is* unchanged. A no-op when it already has one.                              | `TaskNotFound`, `Unsupported`                           |

Operations MUST be atomic from the caller's point of view: an operation that
fails MUST leave the list unchanged. For multi-file backends, §2.10 describes
how recovery achieves this.

## 1.5 Capabilities

Some backends cannot support every operation (Jira, for example, may have no
ordering). An implementation declares a set of capabilities:

| Capability    | When absent                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `groups`      | All tasks are ungrouped; a placement that names a group fails with `Unsupported`.                     |
| `reorder`     | `move` and placement anchors fail with `Unsupported`.                                                 |
| `renameGroup` | `renameGroup` fails with `Unsupported`.                                                               |
| `comments`    | `comment` fails with `Unsupported`; `comments` is always empty.                                       |
| `promote`     | `promote` fails with `Unsupported`. A store whose tasks have no separate document declares it absent. |
| `cancel`      | `cancel` fails with `Unsupported`; no task has outcome `cancelled`.                                   |

`load`, `get`, `listDone`, `add`, `update`, `complete`, `reopen` and `remove`
are always required. Tools SHOULD hide unsupported operations rather than
offer them and fail.

## 1.6 Errors and diagnostics

Operation errors:

| Error               | Carries                  | Meaning                                              |
| ------------------- | ------------------------ | ---------------------------------------------------- |
| `TaskNotFound`      | `id`                     | No open or done task has this ID.                    |
| `GroupNotFound`     | `name`                   | No open group has this name.                         |
| `InvalidTransition` | `id`, `status`, `operation` | The operation doesn't apply in the task's status. |
| `ValidationError`   | `issues[]`               | The input or result would violate the model.         |
| `Unsupported`       | `operation`              | The implementation lacks the capability (§1.5).      |
| `StoreError`        | `message`, `cause`       | An I/O, network or backend failure.                  |

**Diagnostics** are non-fatal issues found while reading a list. Each one has
a `severity` (`error`, `warning` or `info`), a `code`, a `message`, and
optionally a `taskId` and a location. Implementations expose them so tools
can report them (for example `todo check`). The model-level checks are:

| Code                   | Severity | Condition                                         |
| ---------------------- | -------- | ------------------------------------------------- |
| `duplicate-id`         | error    | Two tasks share an ID.                            |
| `unknown-dependency`   | error    | `dependsOn` refers to an ID that doesn't exist.   |
| `self-dependency`      | error    | A task depends on itself.                         |
| `dependency-cycle`     | error    | Dependencies form a cycle.                        |
| `cancelled-dependency` | warning  | `dependsOn` refers to a cancelled task.           |

A dependency on a cancelled task is a warning, not an error: cancelling
upstream work is a decision for its dependents, not a broken list. `add` and
`update` MUST NOT reject it.

`add` and `update` MUST fail with `ValidationError` rather than introduce a
self-dependency or a cycle.

---

# Part 2: The todo.md format

## 2.1 The list directory

- A list is a directory, the **list root**, that contains a file named
  exactly `TODO.md`.
- All files belonging to the list MUST be inside the list root.
- Files are UTF-8. New files use LF line endings. Writers preserve the line
  ending style of existing files.
- The RECOMMENDED location for a project's list is a `todo/` directory at the
  project root.

## 2.2 Configuration

`TODO.md` MAY start with YAML frontmatter. The known keys are:

| Key         | Default | Meaning                                                  |
| ----------- | ------- | -------------------------------------------------------- |
| `tasks_dir` | `.`     | Where task files are created, relative to the list root. |
| `done_dir`  | `done`  | Where done task files live, relative to the list root.   |

Both MUST resolve inside the list root. Unknown keys MUST be preserved.

## 2.3 `TODO.md` structure

```markdown
---                        ← optional configuration (§2.2)
done_dir: archive
---
# Acme API                 ← list title: the first level-1 heading

Backlog for the Acme API.  ← list description

- [ ] 14 - Write changelog ← ungrouped tasks

## Backend                 ← a group: each level-2 heading

Server-side work.          ← group description

- [ ] 03 - Fix login redirect
```

- The **list title** is the text of the first level-1 heading. Any further
  level-1 headings are ordinary content.
- Each **level-2 heading** starts a group that extends to the next level-2
  heading or the end of the file. The heading text is the group name.
- The region between the title and the first level-2 heading is the
  **ungrouped section**.
- Within a section (the ungrouped section or a group):
  - Every top-level task item (§2.4) is a task, in document order.
  - Content before the first task item is the section's **description**.
    Before the first group, that is the list description.
  - Any other content (notes between tasks, level-3+ headings, non-task
    lists) is not part of the model and MUST be preserved where it is.
- Headings and items inside code blocks are not structure. Parsers MUST follow
  CommonMark block structure.
- Group names MUST be unique, and so MUST their slugs (§2.8). A violation is a
  `duplicate-group` diagnostic (error).
- A level-2 heading with no text is ordinary content, not a group.
- Nested groups are not supported in this version; level-3+ headings are
  ordinary content.

## 2.4 Task items

A task item is a list item whose paragraph starts with a GFM task checkbox:

```
inline:  - [ ] <id> - <title>
linked:  - [ ] [<id> - <title>](<path>)
```

- **Bullet.** Parsers accept `-`, `*` and `+`; writers use `-`. As in GFM, the
  checkbox must be followed by a space, and an item with no text after the
  checkbox is ordinary content.
- **Checkbox.** `[ ]` means open. `[x]` or `[X]` means "done, not yet
  archived": the task is treated as done (excluded from `load`, included in
  `listDone`, without `completedAt`), and normalization (§2.11) moves it to
  `done_dir`.
- **ID.** One or more digits. The first ` - ` (space, hyphen, space) after
  the ID separates it from the title. `07` and `7` are the same ID.
- **Title.** The rest of the line (or of the link text), trimmed. It MUST NOT
  be empty.
- **Missing ID.** An item without an ID (`- [ ] Buy milk`) is valid input.
  Normalization gives it the next ID. Until then the item is reported as a
  `missing-id` diagnostic (info). A title that itself starts with
  `<digits> - ` must therefore be written with an ID.
- **Linked items.** `<path>` is relative to `TODO.md`. It MUST resolve to a
  file inside the list root; otherwise the item gets an `outside-root`
  diagnostic (error). A missing file is a `broken-link` diagnostic (error);
  the task is still listed, using the link text.

### Body

The lines that belong to the item (per CommonMark list item rules) after its
first line are the **body**. Writers indent body lines by 2 spaces. The body
consists of:

1. An optional **metadata line** (§2.5). It is the first body line only if it
   directly follows the item line with no blank line in between.
2. The **description**: the rest of the body, with the item's indentation
   removed.

A linked item's body SHOULD be empty: its data lives in the task file. If a
linked item has a body, parsers ignore it, preserve it, and report a
`linked-body` diagnostic (warning).

## 2.5 The metadata line

An inline task can carry metadata on its first body line:

```markdown
- [ ] 03 - Fix login redirect
  #bug #year1 @lemol depends_on:1,2 estimate:3
  Users land on /home instead of the page they requested.
```

The line is metadata only if **every** token on it is one of:

| Token         | Means                          | Syntax                                                                                    |
| ------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `#tag`        | adds `tag` to `tags`           | `#` followed by one or more letters, digits, `_`, `-`, `/` or `.`                         |
| `@name`       | sets `assignee`                | `@` followed by the same character set                                                    |
| `key:value`   | sets field `key`               | `key` is `[a-z][a-z0-9_]*`. `value` is one or more non-whitespace characters and MUST NOT start with `/`, so URLs such as `https://…` never match |

Otherwise the line is ordinary description.

- **Separators.** Tokens are separated by whitespace, or by a comma that is
  immediately followed by `#` or `@`. So `#bug,#year1` is two tags. Writers
  separate tokens with single spaces.
- **Values.** In `key:value`, commas split the value into a list for the
  list fields `tags` and `depends_on`. Every other value is read as a single
  YAML plain scalar, so `estimate:3` is the number 3.
- **Equivalent forms.** `tags:a,b` is the same as `#a #b`, and
  `assignee:lemol` is the same as `@lemol`. Writers use the `#` and `@`
  forms.
- **Reserved keys.** `title`, `completed_at`, `group`, `id`, `outcome` and
  `cancelled_reason` MUST NOT appear on a metadata line. Parsers ignore them
  and report a `reserved-field` diagnostic (error).
- **Multiple assignees.** More than one `@name` is a `multiple-assignees`
  diagnostic (error); parsers use the first.
- **Invalid values.** A `depends_on` value that is not a comma-separated list
  of IDs is an `invalid-metadata` diagnostic (error), and the field is
  ignored.
- **Escaping.** A writer producing an inline task whose description's first
  line would itself parse as metadata MUST put a blank line between the item
  line and the description.
- **Promotion.** Values that cannot be written as a single token (such as
  strings with spaces or nested structures) require a task file. Writers MUST
  promote the task (§2.9) instead.

## 2.6 Task files

```markdown
---
title: Add rate limiting
tags: [api, security]
assignee: lemol
depends_on: [3]
estimate: 3
---
Token bucket per API key, 100 requests per minute.

## Comments

### @claude at 2026-09-12 12:00 +01:00

Started on the token bucket. Open question:

- [ ] per-key or per-IP?

### @lemol at 2026-09-11 09:30 +00:00

Let's do this after the login fix.
```

### Frontmatter

YAML between `---` lines at the start of the file.

| Field          | Type                  | Notes                                                                   |
| -------------- | --------------------- | ----------------------------------------------------------------------- |
| `title`        | string                | Takes precedence over the link text in `TODO.md`. REQUIRED in done files. |
| `tags`         | list of strings       | A single string is accepted as one tag.                                  |
| `assignee`     | string                |                                                                          |
| `depends_on`   | list of IDs           | Integers or digit strings; a single value is accepted.                   |
| `completed_at` | timestamp             | Done files only; REQUIRED there. ISO 8601 with offset.                   |
| `group`        | string                | Done files only: the group display name at completion.                   |
| `outcome`      | `completed` \| `cancelled` | Done files only. Absent means `completed`. Any other value is `invalid-frontmatter`. |
| `cancelled_reason` | string            | Cancelled files only. Present when `outcome` is not `cancelled` is `invalid-frontmatter`; the field is ignored. |

Either key is meaningful only in a done task's file; parsers ignore it on an
open task.

- Any other field goes to `extra` and MUST be preserved, including comments
  and key order where possible.
- For an open task, the ID comes from its `TODO.md` item. For a done task, it
  comes from the file name (§2.8).
- If an open task's file name has an ID prefix different from its item's ID,
  that is an `id-mismatch` diagnostic (warning).
- Frontmatter that is invalid YAML or has wrongly typed standard fields is an
  `invalid-frontmatter` diagnostic (error).

### Description and comments

- The **description** is the Markdown after the frontmatter, up to the
  comments section (or the end of the file). Writers do not add a level-1
  title heading; the title lives in frontmatter.
- The **comments section** is a level-2 heading whose text is exactly
  `Comments`. It MUST be the file's last level-2 heading, so descriptions may
  use other level-2 headings above it.
- Each **comment** is a level-3 heading followed by the comment body:

  ```
  ### @<author> at <YYYY-MM-DD HH:mm[:ss][ offset]>
  ```

- **Timestamps.** Parsers accept `T` in place of the space. The offset
  (`+01:00`, `-05:00` or `Z`) is optional; if absent, the time is UTC.
  Writers always include an offset.
- The body extends to the next level-3 heading or the end of the file.
  Comment bodies MUST NOT contain level-1 to level-3 headings; use level 4
  or deeper.
- A level-3 heading in the comments section that does not match the form
  above is an `invalid-comment` diagnostic (error), and its body is not read
  as a comment.
- **Order.** Comments SHOULD be ordered newest first. Writers insert new
  comments directly below the `## Comments` heading. Parsers MUST NOT reorder
  comments.

## 2.7 IDs

- IDs are positive decimal integers.
- **Model form.** Their canonical string form in the model has no leading
  zeros (`"7"`).
- **Written form.** Writers zero-pad IDs to at least 2 digits (`07`, `12`,
  `105`). Parsers ignore leading zeros.
- **Next ID.** A new ID is one more than the largest ID found in:
  - items in `TODO.md`,
  - `<digits>-*.md` file names directly in `tasks_dir` and its group
    directories,
  - `<digits>-*.md` file names under `done_dir`.

  No counter is stored.
- **Branch collisions.** Two branches can allocate the same ID concurrently.
  After merging, this is a `duplicate-id` diagnostic, resolved by giving one
  of the tasks a new ID (§2.10 explains how interrupted completions differ).

## 2.8 Paths and slugs

- **Slug.** A slug is made by:
  1. Unicode NFKD normalization, then removing combining marks.
  2. Lowercasing.
  3. Replacing each run of characters other than ASCII letters and digits
     with `-`.
  4. Trimming leading and trailing `-`.
  5. Truncating to 60 characters at a `-` boundary where possible.

  An empty result becomes `task` (for titles) or `group` (for groups).
- **Task file path.** `<tasks_dir>/<group-slug>/<id>-<title-slug>.md`, or
  `<tasks_dir>/<id>-<title-slug>.md` for ungrouped tasks.
- **Done file path.** `<done_dir>/<group-slug>/<id>-<title-slug>.md`, or
  `<done_dir>/<id>-<title-slug>.md` if completed while ungrouped.
- **Links.** Writers make links relative to `TODO.md`, starting with `./`, with
  `/` separators.
- **Convention, not rule.** These paths are a convention for writers.
  Parsers accept a linked task file anywhere inside the list root. Writers:
  - name new files by the convention;
  - do not rename a file when its title changes;
  - apply the convention's directory when a task moves group (keeping the
    file name), and its full name when a task is completed.
- **Done files** MUST be named `<id>-<slug>.md`, because that is where their
  ID comes from.
- **Orphan files.** A `<digits>-*.md` file directly in `tasks_dir` or in one
  of its group directories (outside `done_dir`) that no item links to is an
  `orphan-file` diagnostic (warning). Other directories are not scanned.

## 2.9 Inline and file-backed tasks

- A task is **inline** (all its data lives in its `TODO.md` item) or
  **file-backed** (a linked item plus a task file).
- **Promotion** turns an inline task into a file-backed one:
  1. Create the task file by the convention (§2.8). The metadata line becomes
     frontmatter, and the description becomes the file body.
  2. Replace the item and its body with a linked item.
- **When writers MUST promote:**
  - when adding a comment;
  - on completion;
  - when a value cannot be written as a metadata token (§2.5).

  Writers MAY also promote on request or when a description grows long. The
  `promote` operation (§1.4) is that request; there is no demote, and writers
  do not demote file-backed tasks automatically.

## 2.10 Operations in the format

This section defines how each Part 1 operation changes files. Every write MUST
produce a **minimal diff**: only the lines the operation is about change. Hand-
written prose, blank lines, bullet styles and unknown fields elsewhere MUST be
left byte-for-byte intact.

- **add:**
  1. Allocate an ID (§2.7).
  2. Write an inline item, or a task file plus a linked item when the input
     needs one (§2.9).
  3. Insert the item after the last task item of the target section. If the
     section has no task items, insert it at the end of the section, separated
     from the description by a blank line. A new group is appended as a
     `## <name>` heading at the end of `TODO.md`.
- **update:**
  - Inline task: rewrite the item line, metadata line and description.
  - File-backed task: rewrite the frontmatter fields and body; if the title
    changed, also rewrite the item's link text.
  - Done task: edit its done file.
- **move:**
  1. Remove the item (with its body) from its old position and insert it at
     the new one.
  2. If the group changed and the task file sits in the old group's
     conventional directory, move the file to the new group's directory and
     rewrite the link.
- **complete** runs in this order:
  1. Build the done file's content: from the task file, or, for an inline
     task, from the item as promotion would (§2.9), without writing an
     intermediate task file. Set `completed_at` and `group` (omit `group`
     when ungrouped) and make sure `title` is present.
  2. Write the done file to its done path (§2.8).
  3. Delete the original task file, if any.
  4. Remove the item from `TODO.md`.
- **reopen** runs in this order:
  1. Append a linked item at the end of the recorded group's section, or the
     ungrouped section if that group no longer exists. It points to the task
     file path for that section.
  2. Write the task file there, without `completed_at` and `group`.
  3. Delete the done file.

  The task stays file-backed.

**Recovery.** For `complete` and `reopen`, the done file is the commit
point: `complete` writes it first, and `reopen` deletes it last.

- **Detection.** An open item that shares both ID and title with a done file
  is an `interrupted-completion` diagnostic (warning), whether or not its
  task file still exists.
- **Repair.** Normalization finishes the completion: it removes the item and
  any leftover task file. So an interrupted `complete` ends up completed, and
  an interrupted `reopen` is rolled back. Either way the list is in a state
  some complete operation could have produced.
- **Different titles.** The same ID with *different* titles is a
  `duplicate-id` error and is left for a human.
- **Other operations.** Other multi-file operations SHOULD order their steps
  so that an interruption leaves a state that a diagnostic reports, such as
  `orphan-file` or `broken-link`.
- **remove:** delete the item (and its body) and the task file, or the done
  file.
- **renameGroup:**
  1. Rewrite the level-2 heading.
  2. Move `<tasks_dir>/<old-slug>/` to `<tasks_dir>/<new-slug>/`.
  3. Rewrite the links that pointed into it.

  Files outside the old directory stay where they are. Done files are not
  touched.
- **promote:** perform the promotion of §2.9, and nothing else. A task that
  is already file-backed, or done and so already in its done file, is left
  alone.
- **comment:**
  1. Promote the task if it is inline.
  2. Create the `## Comments` section at the end of the file if missing.
  3. Insert the new comment directly below the heading, followed by a blank
     line.

**Canonical forms.** Lines that a writer creates or rewrites use these forms:
`- [ ] ` items, 2-digit minimum IDs, space-separated metadata tokens, 2-space
body indentation, and `./` links. Writers do not reformat lines an operation
does not touch.

## 2.11 Normalization

`TODO.md` is meant to be edited by hand. Normalization brings a hand-edited
list back to canonical state. It performs, in order:

1. **Assign IDs** to items without one, in document order.
2. **Finish interrupted completions** (§2.10).
3. **Sweep checked items.** Complete every `[x]` item, with `completed_at` set
   to the time of normalization.
4. **Sync link text.** Set the link text of file-backed items to
   `<id> - <title>`, using the title from frontmatter.

Normalization MUST touch only the lines these steps require.

**When it runs:**

- **Before every mutating operation.** It MUST be applied first, and the
  operation then acts on the normalized list.
- **Never on reads.** Read-only operations MUST NOT write. They report
  pending work as diagnostics:

  | Code                     | Severity | Pending work                          |
  | ------------------------ | -------- | ------------------------------------- |
  | `missing-id`             | info     | An item needs an ID.                  |
  | `checked-item`           | info     | A `[x]` item needs to be swept.       |
  | `interrupted-completion` | warning  | A completion needs to be finished.    |
  | `stale-link-text`        | info     | Link text differs from the title.     |

- **On request.** Tools SHOULD offer normalization as an explicit command.

## 2.12 Diagnostics reference (format)

These are in addition to the model checks in §1.6:

| Code                     | Severity | Section |
| ------------------------ | -------- | ------- |
| `duplicate-group`        | error    | §2.3    |
| `outside-root`           | error    | §2.4    |
| `broken-link`            | error    | §2.4    |
| `linked-body`            | warning  | §2.4    |
| `reserved-field`         | error    | §2.5    |
| `multiple-assignees`     | error    | §2.5    |
| `invalid-metadata`       | error    | §2.5    |
| `orphan-file`            | warning  | §2.8    |
| `id-mismatch`            | warning  | §2.6    |
| `invalid-frontmatter`    | error    | §2.6    |
| `invalid-comment`        | error    | §2.6    |
| `missing-id`             | info     | §2.11   |
| `checked-item`           | info     | §2.11   |
| `stale-link-text`        | info     | §2.11   |
| `interrupted-completion` | warning  | §2.10   |

## 2.13 Worked example: completing a task

Starting state:

```markdown
## Backend

- [ ] [07 - Add rate limiting](./backend/07-add-rate-limiting.md)
- [ ] 03 - Fix login redirect
  #bug @lemol
  Users land on /home instead of the page they requested.
```

`complete 3` removes three lines from `TODO.md` and nothing else:

```diff
 ## Backend

 - [ ] [07 - Add rate limiting](./backend/07-add-rate-limiting.md)
-- [ ] 03 - Fix login redirect
-  #bug @lemol
-  Users land on /home instead of the page they requested.
```

It also creates `done/backend/03-fix-login-redirect.md`:

```markdown
---
title: Fix login redirect
tags: [bug]
assignee: lemol
group: Backend
completed_at: 2026-09-12T10:31:00Z
---
Users land on /home instead of the page they requested.
```

---

## Appendix A: Out of scope for 0.1

These are left out on purpose, to be revisited with real use:

- Nested groups.
- An in-progress status (use `assignee` to claim a task).
- Priorities other than position.
- Due dates.
- Renumbering after ID collisions.

Implementations can carry such data in `extra` in the meantime.
