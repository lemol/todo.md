# 57 A rebased link is re-spelled with percent escapes

Run `01M5GJ1SBTXPV2PRK8VPWDX2Y3`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `d9ecf4c`. The code is `9901f13` (`701a2a7` on the branch).

## Attempts

- triage#1 (oc_go_spark_xh) assessed moderate/medium backend and switched
  to the reviewed flow.
- do#1 (oc_go_spark_m) rewrote `rebaseTaskLinks` (`src/fs/links.ts`) to keep
  the longest run of trailing raw segments whose decoded values match the
  new path, write only the changed leading steps fresh (`encodeFresh`, plain
  vs `<…>` safelists), copy the raw query/fragment verbatim, and prefix `./`
  to a new relative that starts with neither `.` nor `..`. Added the five
  brief rows as link, image and definition in `test/fs/links.test.ts`.
- check#1 passed (1492 tests) after waiting six and a half minutes for the
  machine gate slot.
- review#1 (oc_go_spark_xh) approved: pinned each row, reversed the fix in a
  scratch worktree (15 fail), measured 2000 links in 128 ms.

## Controller review (intensive)

- Tests first / Done when: the five rows are pinned by "rebased <syntax>
  preserves spelling <written> byte-for-byte" and "… ./sib.md
  byte-for-byte" in `test/fs/links.test.ts`, archived text and reopened
  bytes both asserted. review#1's reversal already showed them red on the
  base; I did not repeat it. The "retains decoded target" cases still pass
  (gate).
- What to build 1 (keep spelling, rewrite only changed steps): done. 2
  (byte-for-byte reopen, `./` included): done for `./`, but at the cost of
  the bare spelling.
- Comments: the task file has only the orchestrator's closing comment; the
  brief had none.
- Defect, filed as 60 (a decision): the unconditional `./` prefix makes a
  bare link into the task's own directory reopen as `./…`; the base
  round-tripped it. Probe on `d9ecf4c` (script in the attempt directory,
  real files): `sib.md` → `../../group/sib.md` → `./sib.md`; `sub/x.md` →
  `./sub/x.md`; `a&amp;b.md` → `./a&amp;b.md`; `sib.md#h` → `./sib.md#h`.
  The archived text cannot say which spelling the original had, so 57's
  brief asked for two round trips that cannot both hold. This list's task
  files use both (2 `./`, 2 bare). review#1's class check tried entities,
  percent escapes and query strings but not the bare form of the `./` row:
  a miss.
- Class probes that held: `./sub/x.md`, `../top.md`, `../a%20b/y.md`,
  `<../a b/y.md>`, `./a&amp;b.md` all round-trip byte-exact. `.././top.md`
  normalises to `../top.md` (a non-minimal path; not filed).
- No timings regeneration: no test file added, moved or deleted, and this
  repository has no `test/timings.json`.
- Friction for the orchestrator (not filed here): the brief names its
  dogfooding skill's `scripts/review-lock`, which exists only in the
  orchestrator's checkout, not in todo-md; `rating.ts` must still run from
  that checkout (noted at 54); its skeleton leaves `flow.fit` as `null`
  without naming the `too-light | right | too-heavy` choices `rate` wants.
