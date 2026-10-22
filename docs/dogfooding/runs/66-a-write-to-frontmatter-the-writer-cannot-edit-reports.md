# 66 A write to frontmatter the writer cannot edit reports success and loses the change

Run `01M5GY12N5NBDM94VGGKMW955K`, loop `01M5GFQE4CEH965H2CH9XZYRSS` (width
1). Landed `1efcb60`. The code is `6b53f5f` and `827b3c7`.

## Attempts

- triage#1 (cc_sonnet_m) routed to the planned flow (moderate, backend).
- plan#1 (cc_opus_hg): `frontmatterEdits` and `updateTaskFile` return a
  `Result`; a new `editTaskFile` in `src/fs/writing.ts` maps the failure
  to `StoreError("cannot edit <path>: invalid-frontmatter: …")` at all 5
  call sites. Not-a-mapping frontmatter fails too; valid flow maps and `~`
  keep the whole-replace. Ran its tests at base: fs 5 fail, CLI 2 fail.
- do#1 (oc_go_spark_m) built it as planned; no CLI code change. check#1
  (`bun run check`) passed: 1594 tests.
- review#1 (cc_opus_md) approved, with two reversals (block-map splice
  guard: 2 fail; not-a-mapping: 3 fail) and a class check over 17 shapes.

## Controller review (intensive)

- Tests first, each pinned:
  - edit/done/cancel on `{title: Bad, x: *a}` and on `title: Bad\nx: [`
    (title kept, files byte-identical): `test/cli/frontmatter.test.ts`
    "a task whose frontmatter is … > edit, done and cancel fail, name the
    file and change nothing" (both rows; exact stderr, code 1, tree).
  - block-map alias still splices: `test/cli/frontmatter.test.ts` "edit
    still splices a block map whose alias does not resolve" and
    `test/fs/invalidFrontmatter.test.ts` "a block map with an unresolved
    alias still takes a spliced edit".
  - no partial move: `test/fs/invalidFrontmatter.test.ts` "… > fails
    update, complete and cancel and leaves every file as it was" (whole
    `disk.tree()`), and "a done file whose frontmatter cannot be edited >
    fails reopen and update …".
- Reversal (scratch copy of `1efcb60`, removed after): guard in
  `frontmatterEdits` disabled (`if (false && …)`), the two new files give
  6 pass, 7 fail: both CLI rows and all five fs refusal cases.
- What to build: 1 done (5 call sites; comment and promote never edit
  frontmatter, grep shows no other `updateTaskFile` caller); 2 done (fails,
  with the reason); 3 done (spec §2.10 bullet, README, storage.md); 4 done
  with no code change.
- Comments: none before the run; the only one is nzila's closing comment.
- Probes at `1efcb60` (scratch list, own `HOME`, `TODO_MD_HOME`): flow map
  with alias, syntax error, sequence and a CRLF flow map with alias each
  refuse `edit`/`done`/`cancel` with exit 1 and leave the file; `--json`
  gives one `StoreError` line; a block map with alias splices one line; a
  valid flow map is rewritten in block style with every key; a description
  edit and a comment on invalid frontmatter proceed. The web UI maps
  `StoreError` already (`src/web/app/actions/respond.tsx`).
- Fixed on main: `src/markdown/README.md`'s four new continuation lines
  were indented 3 spaces (review#1's note).
- **Found (filed 69):** the failure now prints the reader's message, and
  for a syntax error that gives the YAML's line ("line 2", the file's line
  3; `todo check` puts it at `:1`) and ends at a colon where `yaml`'s code
  frame was cut. Predates 66; 66 made it every failed write's text.
- No timings regeneration: two test files were added, but this repository
  has no `test/timings.json` or `test:timings` script.
