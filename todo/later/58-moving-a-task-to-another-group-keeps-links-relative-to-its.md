---
title: Moving a task to another group keeps links relative to its old group directory
tags: [bug]
---
todo-md:56 made `complete`, `cancel` and `reopen` rebase a moved task file's relative links (spec §2.10, `rebaseTaskLinks` in `src/fs/links.ts`). Two other operations move a task file between directories and still use a bare `files.move`:

- `move` to another group, `src/fs/FsTodoStore.ts` (as of `756b909`, near line 338): `yield* files.move(item.path, path)` when the task changes group;
- `renameGroup` when the new group directory already exists, so each file moves one by one (`if (!moveWhole) yield* files.move(item.path, path)`).

Both keep the depth, so `../../product/...` still resolves, but a link into the task's own or a sibling group directory breaks: `./17-other.md` (a sibling task) or `../other-group/x.md` from a file whose group directory changed. Found by the controller review of 56 by reading the moves; not reproduced in a real list yet.

#### What to build

1. Rebase the moved file's links with `rebaseTaskLinks` in `move` (cross-group) and in `renameGroup`'s per-file branch, before the write, keeping the existing write order.
2. When `renameGroup` moves the whole directory, siblings move with it, so `./x.md` still resolves; decide whether links pointing to the old directory name from inside it (`../old-group/x.md`) need rebasing too, and say so in the spec.
3. Spec §2.10 (or the section describing `move` and `renameGroup`): name these operations alongside `complete`, `cancel` and `reopen`.

#### Tests first

- A task with `[s](./sib.md)` (sibling file exists) moved to another group: the link resolves after the move, red before.
- `renameGroup` into an existing group directory: same check.

#### Done when

Every operation that moves a task file to another directory keeps its existing relative link targets resolving, with a test per operation.

#### Out of scope

Inbound links from other files to the moved one; the re-spelling in 57.
