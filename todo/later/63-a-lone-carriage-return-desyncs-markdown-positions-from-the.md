---
title: A lone carriage return desyncs Markdown positions from the line model
tags: [bug, markdown]
---
Found by the controller's post-land review of todo-md:62 (`1ee7a07`, landed `ca024dd`), probing the lone-CR class 61 and 62 left out of scope. Lone-CR files are rare, but here they lose data rather than just picking the wrong line ending.

**Cause.** mdast (micromark) treats a lone `\r` as a line ending, so a node's `position.line` counts it. `splitLines` (`src/markdown/lines.ts`) splits on `\r?\n` only, so it doesn't count a lone CR. Every splice that maps an mdast line span onto `splitLines` lines is off by one for each lone CR before it. 62's `setFrontmatterFields` now splits the YAML with `textLines`, which counts a lone CR, while the splice range still comes from `lineSpan(yaml)`.

Evidence (scratch scripts calling `src/markdown` from `ca024dd` and from `0fef681`, 62's base):

- `updateTaskFile("---\ntitle: \"a\rb\"\ntags: [a]\n---\nBody\n", { tags: ["b"] })` gives `"---\ntitle: \"a\rb\"\ntags: [b]\nBody\n"` on both commits: the closing `---` is gone, so the file has no frontmatter any more.
- The same with CRLF endings (`"---\r\ntitle: \"a\rb\"\r\ntags: [a]\r\n---\r\nBody\r\n"`): base gives `"---\r\ntitle: \"a\rb\"\r\r\ntags: [b]\r\nBody\r\n"` (fence lost), and `ca024dd` gives `"---\r\ntags: [b]\r\nBody\r\n"`: the title line is lost too. 62 made this case worse.
- A lone CR only in a YAML comment (`# c\rx`) on a CRLF file: `ca024dd` gives `"---\r\ntags: [b]\r\nBody\r\n"`: the title and the fence are lost.
- `updateTaskFile("---\ntitle: T\n---\nline a\rline b\nmore\n", { description: "new" })` gives `"---\ntitle: T\n---\nnew\n"`. That looks right; check that it holds when a `## Comments` section follows.
- `parseTodoFile("# L\n\n## Now\n\n- [ ] one\rstill one\n- [ ] [two](02-two.md)\n- [ ] three\n")` lists two items, `"one\rstill one"` and `"hre"`. Item `two` disappears, and `three`'s title is sliced at the wrong offset.

#### What to build

1. Make one line model hold across the parser and the writers. Either `splitLines` counts a lone CR as a line ending, as mdast and `textLines` do (and the writer then rewrites it to the file's `eol`), or every mdast span is mapped onto `splitLines` lines. Pick one and record why in `src/markdown/README.md`'s line-ending rule. The README already says text that becomes lines splits on a lone CR.
2. Then `setFrontmatterFields`'s output line count, `lineSpan(yaml)` and the splice in `updateTaskFile` agree, and `parseTodoFile`'s item slicing and every `todoFile.ts` writer agree.

#### Tests first

- The frontmatter cases above, on LF and on CRLF files: the result keeps every frontmatter key and the closing fence, and differs only on the changed key's line (plus any lone CR the chosen model rewrites).
- `parseTodoFile` on the TODO.md above lists three items with the right titles, and `removeItem` / `insertItem` around the lone-CR item remove or insert exactly one item.
- A description edit with a lone CR before a `## Comments` section keeps the comments.

#### Done when

No edit to a task file or TODO.md that contains a lone CR drops or garbles a line it didn't change.

#### Out of scope

Classic-Mac files made entirely of lone CRs, beyond not losing data.
