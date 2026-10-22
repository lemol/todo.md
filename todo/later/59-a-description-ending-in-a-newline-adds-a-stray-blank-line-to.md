---
title: A description ending in a newline adds a stray blank line to TODO.md
tags: [bug, cli]
---
Filing 57 and 58 on `756b909` with `todo add --description - <<'EOF'` left two extra blank lines in `todo/TODO.md`, one per add, besides the item lines (removed by hand before commit). Probe in a scratch copy of that `TODO.md` (`todo add --dir <copy> --group Later …`, diffing before and after):

- `--no-description`, `--description plain`, `--description "$(printf 'A\n\nB')"`, and stdin `Body` with no final newline: only the item line is added.
- stdin `Body\n` or `Body\n\nMore\n` (what every heredoc gives): the item line plus one blank line further down the file, after the section's trailing blank lines.

So a description that ends in a newline changes `TODO.md` beyond the item, against spec §2.10's minimal diffs. The `--description -` help text recommends exactly the heredoc that triggers it.

#### What to build

1. Find where the description's trailing newline reaches the `TODO.md` splice (the item lines, or the section's end offset) and stop it: `add` inserts the item's lines and nothing else.
2. Decide whether a stdin description keeps or trims its final newline in the task file, and keep that consistent with `--description <text>`.

#### Tests first

- A CLI or store test: `add --group <existing group> --description -` with stdin `Body\n` against a `TODO.md` whose section is followed by blank lines and another heading; the diff of `TODO.md` is exactly the one item line. Red before the fix.

#### Done when

`add` with a newline-terminated description changes `TODO.md` by the item line only.
