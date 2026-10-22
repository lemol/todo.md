---
title: A lone carriage return desyncs Markdown positions from the line model
tags: [bug, markdown]
group: Later
completed_at: 2026-10-22T03:08:52Z
outcome: completed
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

## Comments

### @nzila at 2026-10-22 03:08:52 +00:00

Done: todo-md:63 lone-CR line model is unified. Two commits on nzila/01M5GR8TK2F1K4NYQ383K3PZMA, worktree clean, no probe artifacts left behind.

What was built (exactly the plan's two tasks):

1. `43b03fa fix(markdown): count a lone CR as a line ending and keep it on untouched lines` — `splitLines` splits on `/\r\n?|\n/`, `Lines` gains a `breaks` array (`"\r"` where a lone CR ended the line), `joinLines` writes those back unchanged while new/rewritten lines take `eol`, `spliceLines` splices `breaks` in step, `taskFileParserVersion` 2 -> 3 (lone-CR descriptions/comments now parse differently; `src/fs/parsing.ts` caches by version), and `src/markdown/README.md` records why: YAML reads a lone CR as content (`title: "a\rb"` is valid, the LF form is not), and mapping mdast spans onto LF/CRLF lines would make whole-line splices hit two nodes on one line (`- [ ] a\r- [ ] b` is two items).

2. `39b8eea fix(markdown): splice frontmatter edits by the lone-CR line model` — `setFrontmatterFields` (only caller was `updateTaskFile`) replaced by `frontmatterEdits(yaml, fields): FrontmatterEdit[]` (last line first), which parses the raw YAML first and only falls back to the lone-CR-as-break text when the raw parse fails; ranges map via a new `lineAt(text, offset)` that counts endings ending at or before the offset. `updateTaskFile` applies each edit as a `spliceLines` at `1 + edit.start`, so untouched YAML lines keep their lone CRs. README "Frontmatter" bullet updated.

One deviation from the plan's draft code: the prototype's `blockMap ? map.items...` did not typecheck after `map` became a reassigned `let` (TS lost the aliased-condition narrowing: `map possibly null`, `items` missing, implicit `any`). I used an inline `isMap(map) && !map.flow` guard instead; `bun run typecheck` then passed with no behavior change.

Verification (lint and typecheck as separate commands, each to completion):
- Tests first: the new tests failed at base/previous code as the plan quoted (`Export named 'frontmatterEdits'/'lineAt' not found`, 6 taskFile lone-CR rows, `lineAt` row, lines/todoEdits/taskFile lone-CR rows).
- `bun run lint` initially failed on formatting in `src/markdown/frontmatter.ts` and `test/markdown/taskFile.test.ts`; ran `bun run fix` (only reflowed a `formatFrontmatter` call, verified in the diff), then `bun run lint` passes.
- `bun run typecheck` passes (after the narrowing fix above).
- `bun test test/markdown test/cli/tasks.test.ts test/fs test/boundaries.test.ts`: 481 pass, 0 fail. Also ran `test/jira/mapping.test.ts test/fs/links.test.ts` (the other `\r` hits that don't use the line model): 81 pass, 0 fail.
- Searches run: `grep -rn 'splitLines|joinLines|spliceLines|setFrontmatterFields|taskFileParserVersion|lineSpan|frontmatterEdits|lineAt' src test` (no remaining `setFrontmatterFields` references; `src/fs/parsing.ts` only reads the version literal, no change needed) and `grep -rln '\r' test` (hits covered above).
- Direct probes of the task's evidence cases now give: LF `"---\ntitle: \"a\rb\"\ntags: [b]\n---\nBody\n"` (fence and title kept), CRLF keeps title and fence, comment-`# c\rx` cases keep every line, description edit before `## Comments` keeps the comments, and `parseTodoFile` lists `["one","two","three"]`.

Gaps (per step rules, not run): the whole gate (`bun run check`) was deliberately not run; the check stage owns it. Reviewer notes in the brief were the plan itself, which was executed as written.

Review: approved (4/5)
Approved. Read the whole diff a178686..HEAD (src/markdown lines.ts, frontmatter.ts, taskFile.ts, README; four test files).

Comments: the task file (todo/later/63-...md) has no Comments section and the brief shows no pre-start comments; 0 comments, 0 authors.

What to build:
1. One line model: done. splitLines in lines.ts splits on /\r\n?|\n/, and Lines.breaks keeps a lone CR on untouched lines. The README line-ending rule records why (YAML reads a lone CR as content; whole-line splices over LF/CRLF-mapped spans would hit two nodes, e.g. `- [ ] a\r- [ ] b`).
2. Agreement of frontmatter output, lineSpan and the splice: done. frontmatterEdits returns line splices and updateTaskFile applies each at 1+start. The parseTodoFile slicing and the todoFile.ts writers follow splitLines. taskFileParserVersion goes from 2 to 3 because src/fs/parsing.ts caches by it.

Required tests:
- Frontmatter lone-CR cases on LF and CRLF: taskFile.test.ts "lone carriage returns" > "changing a key in %j keeps every other line" (5 rows, covering a quoted value, a comment, and the CR-as-break fallback) and "rewriting a value that holds a lone CR replaces all of its lines". frontmatter.test.ts has the edit-level cases.
- parseTodoFile lists three items with the right titles: todoEdits.test.ts "parseTodoFile reads every item at its own lines". removeItem and insertItem remove or insert exactly one item: "removeItem removes exactly one item..." and "insertItem and setItemHead edit only their own lines".
- Description edit before `## Comments` keeps the comments: taskFile.test.ts "replacing the description keeps the comments".
All are exact toBe/toEqual over literals, so any dropped or garbled line fails them.

Independent probes I ran, all correct:
- A lone CR in a multi-line description value.
- A lone CR in a block scalar.
- A lone CR in a quoted title followed by a Comments section, with a title edit.
- A description edit with a lone CR and comments.
- A classic-Mac file (out of scope): no crash.

I did not complete the scratch reversal run (my sed in the scratch copy failed, and I removed the scratch worktree). The implementer reports the new tests failing at the base, and the lone-CR parse test cannot pass with the old splitter.

Gaps: the implementer's only gap is that `bun run check` was not run. check#1 passed it (bun run check, 1556 tests, 107 files) at 39b8eea, which is the check.command; the Done-when names no other command. Lint and typecheck: the implementer ran them and the check passed. I did not run the linter on its own.

Minor, not blocking: joinLines has a redundant `const joined` before the return, and the `estimate` frontmatter test cases are edit-level only (not a task field).

Both commits are the implementation's own and fit the task. No stale `setFrontmatterFields` references remain (the implementer searched src and test; I did not re-run it).

Branch: nzila/01M5GR8TK2F1K4NYQ383K3PZMA

nzila run 01M5GR8TK2F1K4NYQ383K3PZMA
