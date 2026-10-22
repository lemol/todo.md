# Dogfooding nzila on todo-md

nzila loops run this list. This file is their handoff: **Now** holds live
state and the next step, and **Runs** links one file per reviewed run. The
process is the `nzila-dogfood` skill in the nzila repository.

## Now

- **Loop `01M5GFQE4CEH965H2CH9XZYRSS` (intensive, width 1): running.**
  - Resumed from loop `01M5FHVVJ6H539ZGYMN78TTRXJ`'s close (`6f0889a`).
  - Round 1 ran 56 (`756b909`), reviewed: filed 57, 58 and 59.
  - Round 2 ran 57 (`d9ecf4c`), reviewed: filed 60 (a decision: a bare
    link into the task's own directory now reopens as `./…`; the archived
    text cannot carry both spellings).
  - Round 3 ran 58 (`5b497de`), reviewed: filed nothing.
  - Round 4 ran 59 (`877b01e`), reviewed: filed 61 (a CRLF description
    rewrites all of `TODO.md` to CRLF; predates 59).
  - Round 5 ran 61 (`6af1afe`), reviewed: filed 62 (a CRLF task file's
    frontmatter edit writes `\r\r\n`; the planner's follow-up).
  - Round 6 ran 62 (`ca024dd`), reviewed: filed 63 (a lone CR desyncs
    mdast positions from `splitLines`, so edits drop frontmatter lines and
    the fence, and TODO.md items garble; 62 made the frontmatter case
    worse).
  - Round 7 ran 63 (`57a5cc6`), reviewed: filed 64 (the writer edits
    frontmatter that only parses with lone CRs as breaks, which the reader
    still reports as `invalid-frontmatter`).
  - Round 8 ran 64 (`d8f93e1`), reviewed: filed 65 (an unresolved YAML
    alias throws from `toJS()`, so one task file crashes every read;
    predates 64).
  - Round 9 ran 65 (`318d1ca`), reviewed: filed 66 (a write to
    frontmatter the writer cannot edit reports success and drops the
    change, including `done`'s `completed_at` and `cancel`'s reason) and
    67 (an unresolved alias in the hub registry crashes every command; the
    65 brief wrongly ruled the registry out).
  - Round 10 ran 67 (`6c99e59`), reviewed: filed 68 (an aliased
    `projects` map reads as "not a map", against 67's README line; `rm`'s
    alias refusal blames the file, not the edit).
  - Round 11 ran 66 (`1efcb60`), reviewed: filed 69 (a frontmatter
    syntax error's message gives the YAML's line and ends at a colon; the
    message every failed write now prints). Fixed the README indent.
  - Round 12 proposes 68 alone: width 1, so no pairing question. It
    touches `src/hub` only, no reviewer or `do` text, no
    `src/runner/git/ops.ts`, and no task id another run holds. 69 waits a
    round (minor, `src/markdown`).
- **Loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (intensive, width 1): stopped.**
  - Round 1 ran 46 (`a1df35a`), which filed 48, 49, 50 and 51.
  - Rounds 2 to 8 ran 48 (`f454ec5`), 47 (`33e317e`), 49 (`b8b3f13`), 51
    (`5542b21`), 52 (`3cfa7b2`), 53 (`67e4a6b`) and 54 (`fceb4e2`), all
    reviewed. The 54 review filed nothing.
  - Stopped after 54: the only open task is 50, and it waits for the
    person.
  - Closed (todo-md:n14): the closing audit rated 46's two reviews
    (pi_sol_m 5, cc_opus_m 4). No loop member was reviewed by a profile
    the stats call stale, so the sample took the fewest-rated ones.
- **Next:** 68, then 69. The person decides 50 (installed bin), 55
  (54's note (a): a per-run `TMPDIR` or a lint, so a raw `mkdtemp` can't
  leak) and 60 (which spelling a reopened own-directory link takes).

## Runs

| Run | Landed | Follow-ups |
| --- | --- | --- |
| [66 A write to frontmatter the writer cannot edit reports success and loses the change](dogfooding/runs/66-a-write-to-frontmatter-the-writer-cannot-edit-reports.md) | `1efcb60` | 69; ratings recorded |
| [67 An unresolved alias in the hub registry crashes every command](dogfooding/runs/67-an-unresolved-alias-in-the-hub-registry-crashes-every.md) | `6c99e59` | 68; ratings recorded |
| [65 An unresolved YAML alias in frontmatter crashes every read](dogfooding/runs/65-an-unresolved-yaml-alias-in-frontmatter-crashes-every-read.md) | `318d1ca` | 66, 67; ratings recorded |
| [64 Frontmatter the writer edits by lone-CR lines still reads as invalid](dogfooding/runs/64-frontmatter-the-writer-edits-by-lone-cr-lines-still-reads-as.md) | `d8f93e1` | 65; ratings recorded |
| [63 A lone carriage return desyncs Markdown positions from the line model](dogfooding/runs/63-a-lone-carriage-return-desyncs-markdown-positions-from-the.md) | `57a5cc6` | 64; ratings recorded |
| [62 Editing a CRLF task file's frontmatter writes a stray carriage return](dogfooding/runs/62-editing-a-crlf-task-file-s-frontmatter-writes-a-stray.md) | `ca024dd` | 63; ratings recorded |
| [61 A CRLF description rewrites every line of TODO.md to CRLF](dogfooding/runs/61-a-crlf-description-rewrites-every-line-of-todo-md-to-crlf.md) | `6af1afe` | 62; ratings recorded |
| [59 A description ending in a newline adds a stray blank line to TODO.md](dogfooding/runs/59-a-description-ending-in-a-newline-adds-a-stray-blank-line-to.md) | `877b01e` | 61; ratings recorded |
| [58 Moving a task to another group keeps links relative to its old group directory](dogfooding/runs/58-moving-a-task-to-another-group-keeps-links-relative-to-its.md) | `5b497de` | none; ratings recorded |
| [57 A rebased link is re-spelled with percent escapes](dogfooding/runs/57-a-rebased-link-is-re-spelled-with-percent-escapes.md) | `d9ecf4c` | 60; ratings recorded |
| [56 A task moved to done/ keeps links that pointed from its old directory](dogfooding/runs/56-a-task-moved-to-done-keeps-links-that-pointed-from-its-old.md) | `756b909` | 57, 58, 59; ratings recorded |
| [54 A test run leaves its temporary directories behind](dogfooding/runs/54-a-test-run-leaves-its-temporary-directories-behind.md) | `fceb4e2` | 55 (filed at the close); ratings recorded |
| [53 A hub test's temporary list vanishes under concurrent test runs](dogfooding/runs/53-a-hub-test-s-temporary-list-vanishes-under-concurrent-test.md) | `67e4a6b` | 54; ratings recorded |
| [52 The web JSX loader shifts every tsx stack-trace line by one](dogfooding/runs/52-the-web-jsx-loader-shifts-every-tsx-stack-trace-line-by-one.md) | `3cfa7b2` | none; ratings recorded |
| [51 The fs watch test that skips git's directory is flaky under load](dogfooding/runs/51-the-fs-watch-test-that-skips-git-s-directory-is-flaky-under.md) | `5542b21` | 53; ratings recorded |
| [49 todo web from source renders an empty page outside the repository](dogfooding/runs/49-todo-web-from-source-renders-an-empty-page-outside-the.md) | `b8b3f13` | 52; ratings recorded |
| [47 Hash parse-cache keys with Bun.hash](dogfooding/runs/47-hash-parse-cache-keys-with-bun-hash.md) | `33e317e` | none; ratings recorded |
| [48 The sandbox guard fails a test for another process's parse-cache write](dogfooding/runs/48-the-sandbox-guard-fails-a-test-for-another-process-s-parse.md) | `f454ec5` | none; ratings recorded |
| [46 Ship the todo CLI as a bundle](dogfooding/runs/46-ship-the-todo-cli-as-a-bundle.md) | `a1df35a` | 48, 49, 50, 51; ratings recorded |
