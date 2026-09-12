# @lemol/todo-md/markdown

Pure parser and writer for the
[todo.md file format](../../docs/spec.md#part-2-the-todomd-format): `TODO.md`
and task files in, model and edited text out. It does no I/O.

> Status: scaffolded, not implemented yet.

## Contents

| Area            | Exports (planned)                                                                 |
| --------------- | --------------------------------------------------------------------------------- |
| Parsing         | `parseTodoFile(text)` and `parseTaskFile(text)`, returning the model, a source map and diagnostics |
| Editing         | `insertTask`, `removeTask`, `setItemLine`, `setMetadataLine`, `setFrontmatter`, `prependComment`, … each returning new text |
| Normalization   | `normalize(snapshot)`, which returns the edits for spec §2.11                     |
| Conventions     | `slug`, `formatId` / `parseId`, `taskFilePath`, `doneFilePath`                    |
| Metadata line   | `parseMetadataLine` / `formatMetadataLine` (spec §2.5)                            |

## How it works

- **Reading:** `mdast-util-from-markdown` with the GFM task-list and
  frontmatter extensions builds a CommonMark AST with source offsets.
- **Writing:** edits splice the original text at those offsets, and new lines
  come from canonical templates. It never re-serializes the AST, which is what
  keeps diffs minimal (spec §2.10).
- **Frontmatter:** edited through `yaml`'s `Document` API, so comments, key
  order and unknown keys survive.

It runs anywhere JavaScript runs (Bun, Node, browsers).

## Testing

Golden fixtures: `test/fixtures/<case>/input.md` + an operation →
`expected.md`. Each case asserts that only the expected lines changed.

## May import (enforced by `test/boundaries.test.ts`)

- [`spec`](../spec)
- `effect`
- `mdast-util-from-markdown`, `mdast-util-frontmatter`,
  `mdast-util-gfm-task-list-item` and the matching `micromark-extension-*`
  packages
- `yaml`

## Not here

- Reading or writing files, locking: see [`fs`](../fs).
