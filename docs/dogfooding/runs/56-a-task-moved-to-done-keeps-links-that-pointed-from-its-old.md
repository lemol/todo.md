# 56 A task moved to done/ keeps links that pointed from its old directory

Run `01M5GFSJB0W0BXB5F6XWCE9GPN`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `756b909`. The code is `b0c605b`, `86f28c2` and `dd508d7`.

## Attempts

- triage#1 (cc_sonnet_m) assessed moderate/medium backend and switched to
  the planned flow.
- plan#1 (cx_sol_m) reproduced complete, cancel and reopen failing (0 pass,
  3 fail), and planned a shared rebaser with Markdown destination spans and
  the existing crash-recovery order.
- do#1 (cc_sonnet_m) added `markdownLinkDestinations` (`src/markdown/links.ts`)
  and `rebaseTaskLinks` (`src/fs/links.ts`), wired into `completeEntry`,
  `cancelEntry` and `reopen`, with exact-body tests in
  `test/fs/writing.test.ts`.
- review#1 (pi_sol_m) asked for changes: R1 `encodeURI` broke escaped
  parentheses and entity-looking names; R2 entity destinations were skipped;
  R3 the label scan ran past the node; R4 the plan's `Effect.fnUntraced`.
- do#2 (pi_sol_m) fixed R1 to R4 test-first, switching `encode` to
  `encodeURIComponent` per segment.
- review#2 (cc_opus_md) asked for R5: an entity destination holding `<`/`>`
  was skipped. review-fix#1 fixed it (`dd508d7`). review#3 (cc_opus_m)
  approved, noting a harmless trailing-backslash skip.
- check#1 to #3 passed (1442, 1468, 1477 tests); check#3 waited nine
  minutes for the machine gate slot.

## Controller review (intensive)

- Done when:
  - done, cancel and reopen rewrite relative links: `test/fs/writing.test.ts`,
    "`${operation} preserves relative Markdown targets`" (exact bodies).
  - URLs, `#…` and unresolved links left alone: the same exact bodies.
  - A link resolving before, after done and after reopen: the same tests,
    plus `test/fs/links.test.ts` "rebased … retains decoded target … in both
    directions". review#3's single-expect reversal (archived `exists` to
    `false`) failed 27 tests; I did not repeat it.
- Comments: the task file's only comment is nzila's closing comment; the
  brief had none. No numbered build items; plan task 1 is done.
- Defect, filed as 57: `encode` rebuilds every rebased destination with
  `encodeURIComponent`, so the author's spelling is lost and done then reopen
  does not round-trip. Probe on `756b909` (scratch test, real files):
  `../a+b.md` → `../../a%2Bb.md` → `../a%2Bb.md`; `../über.md` →
  `../%C3%BCber.md`; `<../My Notes.md>` → `<../My%20Notes.md>`;
  `../a,b@c.md` → `../a%2Cb%40c.md`; `./sib.md` → `sib.md`. review#2 saw
  only the non-ASCII case and called it optional.
- Defect, filed as 58: `move` to another group and `renameGroup`'s per-file
  branch still call bare `files.move` (`src/fs/FsTodoStore.ts`), so a link
  to a sibling task (`./x.md`) breaks. Same depth, so `../../…` survives.
  Found by reading, not reproduced.
- Friction, filed as 59: filing 57 and 58 with `todo add --description -`
  and a heredoc left one stray blank line per add in `todo/TODO.md`
  (removed by hand). A scratch-copy probe narrowed it to a description that
  ends in a newline; without one, only the item line is added.
- No timings regeneration: `test/fs/links.test.ts` is new, but this
  repository has no `test/timings.json`.
- Friction to report to nzila (already noted at 54): the skill's
  `review.ts` and `rating.ts` resolve `bin.ts` from the current git
  toplevel, so they fail from a todo-md worktree; both work from the nzila
  checkout.
