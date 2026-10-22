---
title: Editing a CRLF task file's frontmatter writes a stray carriage return
tags: [bug, markdown]
group: Later
---
Named by todo-md:61's planner and implementer as out of scope, reproduced by the controller on `6af1afe` (61's landing) with a scratch script calling `updateTaskFile` from `src/markdown/taskFile.ts`:

- `updateTaskFile("---\r\ntitle: T\r\ntags: [a]\r\n---\r\nBody\r\n", { tags: ["b"] })` gives `"---\r\ntitle: T\r\r\ntags: [b]\r\n---\r\nBody\r\n"`: the unchanged `title` line gains a `\r` before its `\r\n`.
- `updateTaskFile(…, { title: "U" })` on `"---\r\ntitle: T\r\n---\r\nBody\r\n"` gives a clean `"---\r\ntitle: U\r\n---\r\nBody\r\n"`: the stray `\r` lands on the lines a changed key does not rewrite, when another key follows.

Path: `updateTaskFile` passes the mdast yaml node's `value` (which keeps the file's `\r\n`) to `setFrontmatterFields` (`src/markdown/frontmatter.ts`), which splits it on `"\n"` only (`yaml.split("\n")` and `lineOf`), so each kept line still ends in `\r`; `joinLines` then adds the file's `\r\n`. Confirm the path before fixing. Any `todo edit`, `tag`, `done` or other frontmatter write on a CRLF task file corrupts it this way, which 61's rule ("text that becomes lines never carries a `\r` in", `src/markdown/README.md`) says must not happen.

#### What to build

1. Frontmatter lines kept by `setFrontmatterFields` carry no `\r`: split the YAML on every line ending (`textLines` in `src/markdown/lines.ts`), at whichever boundary keeps `lineOf`'s offsets and the `yaml` library's ranges in agreement.
2. If `readFrontmatter`'s YAML-error message path (`first.message.split("\n")`) can carry a `\r` into a diagnostic, fix it the same way; otherwise say why not in the report.

#### Tests first

- `updateTaskFile` on a CRLF task file with two or more frontmatter keys: changing one key leaves every other line byte-for-byte and the whole file CRLF. Red before the fix.
- The same for deleting a key (`undefined`) and for appending a new key.
- A CLI test: a CRLF task file, `todo edit <id> --tag b`, and the file stays all CRLF with only the changed line differing.

#### Done when

No frontmatter write on a CRLF task file leaves a `\r` before a line ending.

#### Out of scope

Lone-CR (`\r`-only) files: `splitLines` does not treat a lone CR as a line ending, a pre-existing behavior 61 left alone.
