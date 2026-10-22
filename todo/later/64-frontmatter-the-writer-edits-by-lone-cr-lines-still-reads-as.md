---
title: Frontmatter the writer edits by lone-CR lines still reads as invalid
tags: [bug, markdown]
---
Found by the controller's post-land review of todo-md:63 (landed `57a5cc6`), probing the class of YAML 63's writer fallback handles.

**Cause.** 63's `frontmatterEdits` (`src/markdown/frontmatter.ts`) parses the raw YAML first and, when that has errors, reads it again with lone CRs as line breaks (`textLines(yaml).join("\n")`), then edits it by those lines. The README records this ("YAML which only parses with lone CRs as line breaks is edited by those lines"). The reader did not change: `readFrontmatter` parses only the raw YAML, so `parseTaskFile` reports `invalid-frontmatter` for the same text. The writer edits frontmatter the reader cannot see, so an edit reports success and reading back shows nothing.

Evidence (scratch script importing `src/markdown/taskFile.ts` at `57a5cc6`):

- `parseTaskFile("---\ntitle: T\rassignee: z\n---\nBody\n", "x.md")` gives title `null`, assignee `null`, and an `invalid-frontmatter` error ("Nested mappings are not allowed in compact mappings at line 1, column 8").
- `updateTaskFile` on that text with `{ assignee: "y" }` gives `"---\ntitle: T\rassignee: y\n---\nBody\n"`: the writer read `assignee: z` as a key and rewrote it.
- Parsing that result still gives title `null`, assignee `null` and the same error. So `todo assign` succeeds while `todo show` shows no title or assignee.
- `parseTaskFile("---\ntitle: T\rtags: [a]\n---\nBody\n", "x.md")` gives title `null`, tags `[]`, while 63's own test ("changing a key in `---\ntitle: T\rtags: [a]\n---\nBody\n` keeps every other line") edits `tags` as a key.

No data is lost, so this is less severe than 63. It breaks 63's aim that one line model holds across the parser and the writers.

#### What to build

1. Make `readFrontmatter` use the same fallback as `frontmatterEdits`: parse the raw YAML, and only when that has errors, parse it with lone CRs as line breaks. Report `invalid-frontmatter` only when both fail. Share one helper so the two cannot drift.
2. Bump `taskFileParserVersion` (`src/markdown/taskFile.ts`), because `src/fs/parsing.ts` caches parses by it and these files now parse differently.
3. Update `src/markdown/README.md`'s Frontmatter bullet so it says the reader and the writer read such YAML the same way.

#### Tests first

- `parseTaskFile` on `"---\ntitle: T\rtags: [a]\n---\nBody\n"` gives title `T`, tags `["a"]` and no diagnostics, on LF and CRLF files.
- Round trip: `updateTaskFile` with `{ assignee: "y" }` on `"---\ntitle: T\rassignee: z\n---\nBody\n"`, then `parseTaskFile`, gives title `T` and assignee `y`.
- Raw-valid YAML with a lone CR inside a quoted value (`title: "a\rb"`) still reads as the raw parse does: title `"a\rb"`.
- YAML that fails both ways still reports `invalid-frontmatter`.

#### Done when

Every task file whose frontmatter `frontmatterEdits` edits by keys reads back through `parseTaskFile` with those keys.

#### Out of scope

The invalid-YAML fallback that rewrites the whole frontmatter from what parsed (a pre-63 policy).
