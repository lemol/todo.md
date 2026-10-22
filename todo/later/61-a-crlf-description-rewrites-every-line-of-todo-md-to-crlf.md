---
title: A CRLF description rewrites every line of TODO.md to CRLF
tags: [bug, markdown]
---
Controller probe on `877b01e` (todo-md:59's landing), scratch list under the attempt directory with `HOME`/`TODO_MD_HOME` isolated: an LF `TODO.md` (`# L`, `## Later` with one item and two blank lines, `## Next`), then `printf 'Body\r\n' | todo add T --group Later --description -`. Every line of `TODO.md` comes back ending in `\r\n` (`od -c`: `#   L \r \n \r \n # # ...`), not just the new item line. The task file itself is LF (`Body\n`). The base before 59 (`2660661`) does the same, so 59 did not cause it; 59's reviewer named the CRLF input as untried.

Likely path: `formatInlineItem` keeps `Body\r` as a description line, the inline item is spliced in with the file's `\n`, so the text now holds one `\r\n`. The next read (`promote`) runs `splitLines` (`src/markdown/lines.ts`: `const eol = text.includes("\r\n") ? "\r\n" : "\n"`), takes CRLF as the file's line ending, and `joinLines` writes every line back with it. That breaks spec §2.10's minimal diffs. Confirm the path before fixing.

#### What to build

1. Stop a `\r` in a description reaching `TODO.md` as part of a line: a CRLF (or lone CR line end) description is split on `\r?\n` like the file's own lines, at the boundary where descriptions become item lines.
2. Decide whether `splitLines`'s "any `\r\n` means CRLF" rule should stand for a mixed file; say the decision in the markdown module's README, and change it only if the decision says so.

#### Tests first

- CLI or store test: an LF `TODO.md`, `add --group <existing> --description -` with stdin `Body\r\n`; `TODO.md` differs by exactly the item line, all LF. Red before the fix.
- The same with `--inline`: the item's lines are LF, `Body` carries no `\r`.
- A CRLF `TODO.md` with an LF description stays all CRLF.

#### Done when

A description's line endings never change the line endings of the rest of `TODO.md`.

#### Out of scope

Leading blank description lines (probed on `877b01e`: an inline item with stdin `\nBody\n` parses back with description `Body`).
