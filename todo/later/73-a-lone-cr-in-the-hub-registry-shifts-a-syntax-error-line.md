---
title: A lone CR in the hub registry shifts a syntax error line
tags: [bug, hub]
---
Found by the controller's post-land review of todo-md:71 (landed `bcf6fb3`, closed `8026792`). 71 keeps `yaml`'s own line in a registry syntax error, on the brief's ground that "the registry has no fence, so `yaml`'s line is the file's line". `yaml` counts lines by LF only. A lone CR is a line break both to YAML 1.2 (`b-break`) and to this repo's line model (`splitLines`), so each lone CR above the error moves the reported line one short. 72 fixes the same gap for frontmatter, but rules the registry out and names 71. 71 did not cover it, so the registry falls between the two tasks. The 71 reviewer's 17-input class probe tried CRLF but not a lone CR.

Evidence (probe at `8026792`, `parseDocument` as `read` calls it):

- `projects:\n  a: "x\ry"\n  b: [\n` gives `... end with a ] at line 4, column 1`. `splitLines` puts the end of `  b: [` on line 5.
- The same file without the `\r` gives line 3, which is correct.
- A registry that uses lone CR everywhere (`projects:\r  a: 1\r  b: [\r`) reads as one line: `Nested mappings are not allowed in compact mappings at line 1, column 10`.

#### What to build

1. Map the error's offset (`error.pos[0]`) to a line and column using LF, CRLF and lone CR as breaks, and put that in the message in place of `yaml`'s position. `hub` may not import `markdown` (`test/boundaries.test.ts`), so either use a local helper or move a shared one to a module both can import, and update the architecture doc and the boundaries test together. Or state why `yaml`'s line stays, and write the gap down in `src/hub/README.md`.
2. Read 72's outcome first, if it has landed, so the two messages agree.
3. A file that uses lone CR everywhere is out of reach here (`yaml` sees one line). Leave its message as it is.

#### Tests first

- `test/hub/registry.test.ts`, in 71's "syntax errors keep their file position without a dangling colon" loop: `projects:\n  a: "x\ry"\n  b: [\n` names line 5 in its exact message.

#### Done when

A registry syntax error below a lone CR names the line `splitLines` would put it on.

#### Out of scope

Frontmatter (72). How `yaml` parses a registry that uses lone CR everywhere.
