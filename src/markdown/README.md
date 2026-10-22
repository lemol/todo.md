# @lemol/todo-md/markdown

Pure parser and writer for the
[todo.md file format](../../docs/spec.md#part-2-the-todomd-format): `TODO.md`
and task files in, model and edited text out. It does no I/O; the `fs`
adapter reads and writes the files.

> Status: implemented for spec 0.1.

## Contents

| Area | Exports |
| --- | --- |
| `TODO.md` | `parseTodoFile(text)` → `TodoFile`: config, title, description, sections (ungrouped first) with their `TodoItem`s, and diagnostics. `allItems`, `findItem`, `sectionOf`. |
| `TODO.md` edits | `insertItem`, `removeItem`, `replaceItem`, `setItemHead`, `renameSection` (each returns the new text), `formatTodoFile` for a new list. |
| Task files | `parseTaskFile(text, file)` → `TaskFile`. `formatTaskFile(content)` for a new file; `updateTaskFile(text, changes)` and `prependComment(text, comment)` for edits. |
| Items | `formatInlineItem`, `formatLinkedItem`, `parseHead`, `formatHead`. |
| Metadata line | `parseMetadataLine`, `formatMetadataLine`, `fitsMetadataLine` (spec §2.5). |
| Links | `markdownLinkDestinations(source)` → the source ranges of link, image and definition destinations (pure; the caller decides what to rewrite). |
| Model | `inlineTask`, `fileTask` (format → `Task`); `fitsInline`, `inlineItemFor`, `linkedItemFor`, `taskFileFor` (`Task` → format). |
| Normalization | `normalize(todo, context)`: assigns IDs and syncs link text, and lists checked items for the caller to complete (spec §2.11). `staleLinkText`. |
| Conventions | `parseId`, `formatId`, `nextId`, `isId` (spec §2.7); `slug`, `groupSlug`, `taskPath`, `resolveLink`, `linkTarget`, `normalizePath`, `joinPath`, `basename`, `dirname` (spec §2.8). |
| Timestamps | `formatInstant` (frontmatter), `formatTimestamp` and `parseCommentHeading` (comments). |

## How it works

- **Reading:** `mdast-util-from-markdown` with the GFM task-list and
  frontmatter extensions finds headings, lists, links and code blocks
  (CommonMark rules), with the line range of every node. Titles, metadata and
  descriptions are then read from the source lines themselves, so nothing is
  lost to re-rendering.
- **Writing:** every edit replaces a line range and returns the new text. Only
  the lines an operation is about change (spec §2.10); new lines use the
  canonical forms. Nothing is ever re-serialized from the AST.
- **Frontmatter:** read with `yaml`. An edit is a set of line splices: only
  the lines of the keys whose value changes are rewritten, so comments,
  quoting and key order elsewhere survive. YAML which only parses with lone
  CRs as line breaks is read and edited by those lines, the same way by the
  reader and the writer. YAML whose aliases do not resolve is an
  `invalid-frontmatter` diagnostic; an edit still splices only the keys it sets
  or deletes and leaves the rest of the frontmatter, the bad alias included,
  as it is.
- **Line endings:** a lone CR is a line ending, as it is to micromark, so
  mdast line numbers index `splitLines` lines. A lone CR on a line no edit
  touches is kept because YAML reads it as content (`title: "a\rb"` is valid,
  and with LF instead it is not), while new and rewritten lines take the
  file's most common ending (LF on a tie or with none), so CRLF files stay
  CRLF. Text that becomes lines (descriptions, comment bodies, frontmatter
  kept or read back from YAML errors) is split on every line ending
  (CRLF, LF or a lone CR) and never carries a `\r` in. Mapping mdast spans
  onto LF/CRLF lines instead is not done: two nodes can share such a line
  (`- [ ] a\r- [ ] b` is two items), so a whole-line splice would edit both.
  A file with mixed endings, as another tool may leave it, has its minority
  lines rewritten on the next edit: the smallest diff one ending per file
  allows. Keeping each line's own ending is not done.

It runs anywhere JavaScript runs (Bun, Node, browsers).

## Who reports what

`parseTodoFile` and `parseTaskFile` report the diagnostics that need only
the text:

- **`TODO.md`:** `invalid-frontmatter`, `duplicate-group`, `outside-root`,
  `id-mismatch`, `linked-body`, `reserved-field`, `multiple-assignees`,
  `invalid-metadata`, `missing-id`, `checked-item`.
- **Task files:** `invalid-frontmatter`, `invalid-comment`.

`staleLinkText` builds `stale-link-text`. The `fs` adapter reports the
diagnostics that need the file system: `broken-link`, `orphan-file`,
`interrupted-completion`, `duplicate-id`.

## Testing

Each file in `src/markdown` has a test file in `test/markdown`. Edits are
tested against exact expected text, so every test also checks that nothing
else changed.

## May import (enforced by `test/boundaries.test.ts`)

- [`spec`](../spec)
- `effect`
- `mdast-util-from-markdown`, `mdast-util-frontmatter`,
  `mdast-util-gfm-task-list-item` and the matching `micromark-extension-*`
  packages
- `yaml`

## Not here

- Reading or writing files, locking: see [`fs`](../fs).
