---
title: A frontmatter syntax error names the YAML line and ends at a colon
tags: [bug, markdown]
---
Found by the controller's post-land review of todo-md:66 (landed `1efcb60`). 66 made the reader's `invalid-frontmatter` message the error a failed write prints, so its two flaws now reach every `edit`, `done`, `cancel` and `reopen` on such a file, not only `todo check`.

Evidence (scratch list at `1efcb60`, own `HOME` and `TODO_MD_HOME`; `later/2-syn.md` = `---\ntitle: Syn\nx: [\n---\nBody\n`):

- `todo edit 2 --assignee y` prints `error: cannot edit later/2-syn.md: invalid-frontmatter: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 5:` and exits 1.
- "line 2" is the line inside the YAML; in the file it is line 3 (the opening fence is line 1). `todo check` reports the same message at `later/2-syn.md:1`, so the two positions it gives disagree with each other and with the file.
- The message ends at a colon: `readFrontmatter` (`src/markdown/frontmatter.ts`) keeps `textLines(first.message)[0]`, and `yaml`'s message continues with a code frame after that colon.

#### What to build

1. The `invalid-frontmatter` message for a YAML error gives the file's line and column (YAML line + 1 for the fence; use the error's `linePos`), or drops `yaml`'s "at line …" suffix and puts the position in the diagnostic's own line instead. State the choice.
2. The message does not end at a dangling colon.
3. `todo check`'s diagnostic line for a YAML syntax error points at the file line of the error, if (1) chose that.

#### Tests first

- `test/markdown/frontmatter.test.ts` or `taskFile.test.ts`: frontmatter `title: Syn\nx: [` gives a message with no trailing colon and, for the chosen form, the file position (line 3).
- `test/cli/frontmatter.test.ts`: the exact stderr of `todo edit` on that file changes to the new message.

#### Done when

A frontmatter syntax error's message and position name the file's line, the same in `todo check` and in a failed write.

#### Out of scope

The hub registry's messages (todo-md:68). Aliases and non-mappings, whose messages carry no position.
