---
title: Read comment text from stdin
completed_at: 2026-09-19T04:14:05Z
outcome: completed
---
Task 21 gave `todo add` and `todo edit` a `-` sentinel on `--description`, read whole from stdin so the shell never sees the text. `todo comment` has the same problem and was left out to keep 21 contained.

Inside double quotes the shell runs each backticked span as a command substitution before the CLI sees it, so a comment like "the cause: `git rev-parse` returned nothing" arrives mangled or empty. Comments are where that bites hardest: they quote commands and their output.

## What to do

- `todo comment <id> -` reads the body from stdin, following `wordsText` in nzila (`src/cli/commands/agent.ts`), where a lone `-` in a variadic argument means stdin.
- Reuse the deferred `CliContext.stdin` that task 21 adds; do not pre-read it.
- Keep the text byte-for-byte: leading and trailing whitespace and newlines included.
- Decide whether `--author` stays as it is (it should).

Consider `edit --title` too, though a title that needs a heredoc is a sign the title is wrong.
