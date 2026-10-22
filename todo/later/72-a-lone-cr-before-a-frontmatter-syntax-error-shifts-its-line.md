---
title: A lone CR before a frontmatter syntax error shifts its line
tags: [bug, markdown]
---
Found by the controller's post-land review of todo-md:69 (landed `d3db970`, closed `7a9dc10`). 69 reports a frontmatter syntax error at "file coordinates": `yaml`'s `linePos` line plus 1 for the opening fence. `yaml` counts lines by LF only, while this repo's line model treats a lone CR as a line ending (`src/markdown/README.md`, "Line endings"; `splitLines` in `src/markdown/lines.ts`; micromark agrees). So every lone CR above the error moves the reported line one short of the file's.

Evidence (probe at `7a9dc10`, calling `parseTaskFile` directly):

- Source `---\ntitle: "a\rb"\nnote: "c\rd"\nx: [\n---\nBody\n`. `splitLines` gives `["---", "title: \"a", "b\"", "note: \"c", "d\"", "x: [", "---", "Body"]`, so `x: [` is file line 6.
- The diagnostic reads `... end with a ] at line 4, column 5`, with `line: 4`.
- With no lone CR (`---\ntitle: Syn\nx: [\n---\nBody\n`), it reads line 3, which is correct. 69's tests cover LF and CRLF only.

A lone CR is legal content in a quoted YAML scalar, and the writer keeps it (README). It is rare, but `todo check` then points at the wrong line, and so does the message every failed write prints.

#### What to build

1. Map `yaml`'s error offset (`first.pos[0]`, an offset into the YAML text) to a file line and column using the same line breaks as `splitLines`: LF, CRLF and lone CR. Then add 1 for the fence. Or state why `linePos` is kept and document the gap in the README.
2. The message and the diagnostic line keep agreeing, as 69 made them.

#### Tests first

- `test/markdown/taskFile.test.ts`, next to 69's "syntax errors use file coordinates": the source above gives line 6 in both the message and the diagnostic's `line`. The same holds for a TODO.md config block (`parseTodoFile`).

#### Done when

A frontmatter syntax error below a lone CR names the line `splitLines` puts it on.

#### Out of scope

The hub registry (71). Lone-CR handling elsewhere.
