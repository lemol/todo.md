---
title: A bare sibling link comes back with a ./ prefix after done and reopen
tags: [bug, decision]
---
todo-md:57 (`9901f13`, landed `d9ecf4c`) made `rebaseTaskLinks` (`src/fs/links.ts`) keep a link's raw spelling, and to make `./sib.md` round-trip it prefixes `./` to every rebased destination whose new relative path does not start with `.` or `..`. The archived form (`../../group/sib.md`) cannot say whether the original was bare or `./`, so the bare spelling, which the code before 57 round-tripped, now changes on reopen. Controller probe on `d9ecf4c` (real files, `group/task.md` to `done/group/task.md` and back):

| written | after done | after reopen |
| --- | --- | --- |
| `sib.md` | `../../group/sib.md` | `./sib.md` |
| `sub/x.md` | `../../group/sub/x.md` | `./sub/x.md` |
| `a&amp;b.md` | `../../group/a&amp;b.md` | `./a&amp;b.md` |
| `sib.md#h` | `../../group/sib.md#h` | `./sib.md#h` |
| `../group/sib.md` | `../../group/sib.md` | `./sib.md` |

Both spellings are real: this list's task files hold 2 `./` and 2 bare links into their own directory (as of `d9ecf4c`). Neither 57's implementer nor its reviewer named the trade; 57's brief asked for both round trips, and the archived text cannot carry both.

#### Decide

Which spelling a reopened link into the task's own directory takes, and say it in spec §2.10:

1. Bare always (the pre-57 behavior, `path.relative`'s own output): `./sib.md` reopens as `sib.md`.
2. `./` always (what `d9ecf4c` does).
3. Follow the file: the spelling the task file's other relative links into their own directory use, bare when there are none.
4. Keep the hint in the archived text (for example `./../../group/sib.md`), at the cost of an odd archived spelling.

Recommendation: 3 if it stays small, else 1.

#### Tests first

- In `test/fs/links.test.ts`: the rows above, as link, image and definition, assert the reopened text the decision names; keep the `./sib.md` rows matching it too.

#### Done when

The spec names the reopened spelling, and the tests pin it for bare and `./` sources.

#### Out of scope

Group moves (58), inbound links from other files.
