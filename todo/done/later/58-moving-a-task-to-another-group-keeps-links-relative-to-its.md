---
title: Moving a task to another group keeps links relative to its old group directory
tags: [bug]
group: Later
completed_at: 2026-10-22T01:50:22Z
outcome: completed
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

## Comments

### @agent at 2026-10-22 01:50:22 +00:00

Done: Addressed review F1 in commit 8def5df (clean working tree).

Verified the finding against the current implementation: renameGroup's inside predicate only accepted descendants of oldDir, excluding oldDir itself. Extended the existing whole-directory regression with [Dir](./), [NamedDir](../backend/), and [Dot](.). Before implementation, `bun test test/fs/writing.test.ts -t 'renameGroup moving the whole directory'` failed (0 pass, 1 fail), receiving ../backend/, ../backend/, ../backend instead of ./, ./, . respectively. After implementation the same command passed (1 pass, 0 fail). The existing destination-existence loop checks these directory links actually resolve after the rename.

Fix: relocate oldDir itself to newDir only when moveWhole. Descendant handling, per-file moves, and write order remain unchanged. No review notes were rejected. The original three plan tasks were already implemented; this follow-up corrects the plan's descendant-only relocation boundary. The existing spec's whole-directory decision remains unchanged.

Verification (separate commands, each completed):
- bun run lint: initially failed formatting in test/fs/writing.test.ts; recorded via a run note before fixing. Formatted only the two changed files with bunx --no-install oxfmt. Re-run passed.
- bun run typecheck: passed before and after formatting.
- bun test test/fs test/git/commits.test.ts test/cli/errors.test.ts test/web/contracts.test.ts test/web/middleware/project.test.ts: 271 pass, 0 fail.
- git diff --check: passed.

Focused-test selection searches actually run:
- rg -n 'renameGroup|rebaseTaskLinks|\.move\("' src/ test/ --files-with-matches
- rg -n '"rename-group"|"move"|renameGroup' test/cli test/web --files-with-matches
These identified fs tests plus git and CLI/web consumers. The changed equality guard is local to FsTodoStore; no shared harness or other adapter changed.

No full gate run (as instructed; check stage owns it). No manifest changes, installs, dependency probes, shared-install writes, or writes outside the worktree. No unmet acceptance items.

Review: approved (5/5)
Review 2 of todo-md:58. I read the whole diff a527d99..8def5df again: src/fs/links.ts, src/fs/FsTodoStore.ts, docs/spec.md, src/fs/README.md, test/fs/links.test.ts and test/fs/writing.test.ts. The only change since review 1 is 8def5df (FsTodoStore.ts +5/-3, writing.test.ts +6/-2).

#### Earlier findings

- F1 (a whole-directory renameGroup broke links to the group directory itself) is **fixed**. `relocate` in FsTodoStore.ts:493-498 now starts with `moveWhole && candidate === oldDir ? newDir`. It applies only in the whole-directory branch, which is correct: the per-file branch keeps `backend/` on disk, so `../backend/` still resolves there.
  - Reversal: in a scratch worktree I restored `8def5df^:src/fs/FsTodoStore.ts` and ran `bun test test/fs/writing.test.ts -t 'renameGroup moving the whole directory'`. Result: 0 pass, 1 fail, "Expected -3 / Received +3". Received was `[Dir](../backend/)`, `[NamedDir](../backend/)` and `[Dot](../backend)`.
  - I then also turned the `expect(text).toBe(` (writing.test.ts:570) into a no-op `void [...]`, so only the existence loop stood. It still failed at writing.test.ts:576 (`disk.exists(server/...)`, Expected true, Received false). The resolve check catches the bug by itself.
- New findings: none.

#### Required tests (brief "Tests first" / "Done when")

- **Move to another group with `[s](./sib.md)`.** Pinned by writing.test.ts "moving a task file to another group keeps its relative links > move to another group rebases the moved file's links". Review 1 confirmed it fails at base, both on the exact text and on the existence loop alone.
- **renameGroup into an existing group directory.** Pinned by "... > renameGroup into an existing directory rebases each moved file's links" (fixture seeds `server/notes.md`). Red at base (review 1).
- **renameGroup moving the whole directory.** Pinned by "... > renameGroup moving the whole directory rebases links naming the old directory". It now includes `./`, `../backend/` and `.`, and is red without 8def5df (above).
- **Done when (a test per operation that moves a task file).**
  - move, renameGroup per-file and renameGroup whole-directory are covered above.
  - complete/cancel/reopen are covered by the existing 56 suite.
  - links.test.ts "keeps links to the moved file itself and to targets that move with it" is red with base links.ts (review 1).
  - Met.

#### What to build

1. Rebase in `move` (cross-group) and in renameGroup's per-file branch. **Done**: FsTodoStore.ts `move` (rebase before `files.move`, write after) and the renameGroup `rebased` map. TODO.md is still written last.
2. Whole-directory decision, recorded in the spec. **Done**: spec §2.10 says the whole-directory rename also rebases, so `../<old-slug>/x.md` becomes `./x.md`. The code now matches it for the directory itself too (F1).
3. Spec names the operations. **Done**: docs/spec.md:560 lists `move`, `renameGroup`, `complete`, `cancel` and `reopen`. The move step 2 and the renameGroup steps 2-4 and src/fs/README.md "Moving task files" are updated too.

#### Comments

I read todo/later/58-moving-a-task-to-another-group-keeps-links-relative-to-its.md. `grep -n -i '^#\|comment\|author'` gives only lines 12, 18, 23 and 27 (What to build, Tests first, Done when, Out of scope). There is no Comments section and the brief has no pre-start comments: 0 comments, no authors.

#### Implementer's stated gaps

- **No full gate run.** Pushed back: the check stage owns it. check.command is `bun run check`, and check.passed is 8def5df (1496 tests across 107 files).
- **Lint at first failed on formatting, fixed with oxfmt on the two changed files.** Done. `bun run lint` exits 0 in a clean scratch at 8def5df, and grepping its output for warning/error finds nothing: 0 warnings. Base a527d99 is the same, 0 warnings.
- **Focused-test searches.** Done. I reran `bun test test/fs test/git/commits.test.ts` at 8def5df: 235 pass, 0 fail. `bun run typecheck` passes.

#### Class check on the changed predicate (`candidate === oldDir`)

I wrote a probe test in a scratch worktree (since removed). It runs whole-directory, per-file and `move` over the following spellings:

- `../backend`, `<./>`, `./?q=1`, `./#f`, `../backend/.`, `./assets/..`, `..`, `../backend/assets/`, `../backend/assets/a.md`, `.//`, `../BACKEND/`;
- reference definitions `[R]: ../backend/`, `[S]: ./03-other.md` and `[T]: ./`, each used.

Results:

- **Whole-directory:**
  - The directory spellings come out as `.`, `<./>`, `./?q=1`, `./#f`, `.`, `.`, `./` or `./assets/`.
  - `..` stays as written.
  - The definitions come out as `./`, `./03-other.md` and `./`.
  - Each resolves under `server/`.
- **Per-file and move:** they keep `../backend...`, and `backend/` still exists in both trees.

Not raised:

- `../BACKEND/` stays as written in whole mode. It only resolves at all on a case-insensitive filesystem. The `before` path is the spelled case, and canonicalizing case is the 57 re-spelling area, which is out of scope.
- An unused definition written right after a paragraph line is not a definition in CommonMark (it cannot interrupt a paragraph), so it is correctly left alone. I first saw it in the probe and confirmed it with the used-definition run.

#### Other checks

- **Cost at scale.** A scratch test ran renameGroup over 300 task files, each with 5 links (`./`, `../backend/`, a sibling, `.`, a missing one), via `bun test --timeout 60000`:
  - HEAD: whole 3896 ms, per-file 3939 ms.
  - Base a527d99: whole 3659 ms, per-file 3614 ms.
  - That is about 6-9% slower, dominated by the existing per-item reparse loop. No finding.
- **Stale copies.** `rg -n 'cancel\` or \`reopen' .` finds docs/spec.md:560, which is live and updated (the line-wrapped "When `move`, `renameGroup`, / `complete`, `cancel` or `reopen`"), and todo/done/later/56, which is dated history. The search is proven against base: `git show a527d99:docs/spec.md | grep -n` finds line 559. 8def5df changed no prose and no quantities.
- **Crash ordering.** Unchanged from review 1: each moved file is written after its move, and TODO.md last.
- **New config, commands or events:** none. `relocate`'s only producer is renameGroup.
- **Colocation:** no new modules.
- **Commits:** all four are scoped (todo-md:58), with conventional prefixes.

#### Score

Quality is 4 for a commit-hygiene detail from round 1: the reformat of links.test.ts landed inside the docs commit.

