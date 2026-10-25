# 58 Moving a task to another group keeps links relative to its old group directory

Run `01M5GKF5WZ5HC80GEH4YE9CMCC`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `5b497de`. The code is `de5919e`..`729658b`.

## Attempts

- triage#1 (cc_sonnet_m) assessed and routed to the planned flow.
- plan#1 (cc_opus_hg) planned three commits: `rebaseTaskLinks` gains an
  optional `relocate(path)` and always follows a link to the moved file
  itself; `move` (cross-group) and both `renameGroup` branches rebase before
  the write; the spec and `src/fs/README.md` name the operations. Its
  `relocate` covered only descendants of the old directory.
- do#1 (cc_sonnet_m) built the plan test-first.
- check#1 passed (1496 tests).
- review#1 (cc_opus_md) asked for changes: F1, a whole-directory
  `renameGroup` rebased `./`, `.` and `../backend/` to `../backend…`, which
  no longer exists, a regression from base.
- do#2 (pi_sol_m) mapped the old directory itself to the new one in the
  whole-directory branch only (`729658b`), the regression extended red first.
- check#2 passed (1496 tests) after about four and a half minutes waiting for
  the machine gate slot held by other gates.
- review#2 (cc_opus_m) approved: reversed the fix (and the text assertion
  alone), probed eleven directory spellings and three reference definitions
  over whole, per-file and `move`, and measured 300 files × 5 links.

## Controller review (intensive)

- Tests first / Done when: `move` with `./sib.md` is pinned by "move to
  another group rebases the moved file's links", `renameGroup` into an
  existing directory by "renameGroup into an existing directory rebases each
  moved file's links", the whole-directory case by "renameGroup moving the
  whole directory rebases links naming the old directory" (all in
  `test/fs/writing.test.ts`, each with a destination-exists loop), and the
  helper by "keeps links to the moved file itself and to targets that move
  with it" in `test/fs/links.test.ts`. Reviews 1 and 2 showed each red at
  base or without `729658b`; I did not repeat the reversals. The 75 tests of
  those two files pass on main.
- What to build 1 (rebase in `move` and the per-file branch, write order
  kept): done; each moved file is written after its move, `TODO.md` last.
  2 (whole-directory decision): done, spec §2.10 says
  `../<old-slug>/x.md` becomes `./x.md`. 3 (spec names the operations):
  done.
- Comments: the brief had none; the task file has only the orchestrator's
  closing comment.
- Read beyond the reviews: `renameGroup` rebases every snapshot entry whose
  path is inside the old directory, any group or checked state, and the move
  loop walks `allItems` with an id, so the two sets agree (both skip items
  without an id). Nothing filed.
- Commit hygiene: the `links.test.ts` reformat landed in the docs commit
  `dfbf301` (review 2 noted it). Not filed.
- No timings regeneration: no test file added, moved or deleted.
- Friction for the orchestrator (not filed here, as at 57): the brief's
  `review-lock` path exists only in the orchestrator's checkout; `rating.ts` runs
  from there; its skeleton's `flow.fit` is `null` without naming
  `too-light | right | too-heavy`, so `rate` refused a numeric guess once.
