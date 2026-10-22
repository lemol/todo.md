---
title: A rebased link is re-spelled with percent escapes
tags: [bug]
---
todo-md:56 (`b0c605b`, `86f28c2`, `dd508d7`) rebases a moved task file's relative links. `encode` in `src/fs/links.ts` rebuilds every rebased destination from the decoded path with `encodeURIComponent` per segment, so characters the author wrote plainly come back escaped, and `done` then `reopen` does not restore the original bytes. Controller probe on `756b909` (scratch test, real files, `todo/group/task.md` to `todo/done/group/task.md` and back):

| written | after done | after reopen |
| --- | --- | --- |
| `../a+b.md` | `../../a%2Bb.md` | `../a%2Bb.md` |
| `../über.md` | `../../%C3%BCber.md` | `../%C3%BCber.md` |
| `<../My Notes.md>` | `<../../My%20Notes.md>` | `<../My%20Notes.md>` |
| `../a,b@c.md` | `../../a%2Cb%40c.md` | `../a%2Cb%40c.md` |
| `./sib.md` | `../../group/sib.md` | `sib.md` |

The links still resolve, but the file a person reads is harder to read, and a done/reopen round trip leaves a diff in lines nobody edited (spec §2.10's minimal diffs). review#2 saw the non-ASCII case and called it optional; the ASCII cases (`+`, `,`, `@`, space) went unnoticed.

#### What to build

1. Keep the destination's own spelling where it can be kept: change only the leading `./`/`../` steps and the path segments the move actually changes, and copy the rest of the raw text (escapes, entities, percent escapes, plain Unicode) as written. Escape only what the destination's form needs (plain vs `<…>`) for a segment that has to be written fresh.
2. A link that was rebased on `done` comes back byte-for-byte on `reopen` when nothing else changed, `./` prefix included where the original had one.

#### Tests first

- In `test/fs/links.test.ts`: the five rows above, each as link, image and definition, assert the archived text and that the reopened text equals the original source exactly (not only the reparsed URL).
- The existing "retains decoded target" cases (parens, entities, angle brackets) keep passing.

#### Done when

Rebasing changes only the path steps the move requires, and done then reopen restores the original bytes for the cases above.

#### Out of scope

Group moves (58), inbound links from other files.
