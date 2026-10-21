---
title: Ship the todo CLI as a bundle
tags: [perf]
---
Most of every `todo` command is loading code, not reading lists. On
2026-10-21 (main 4b48168, bun 1.4.3) `bun -e 0` starts in 16 ms, but
`todo --help` takes 159 ms and importing `src/cli/index.ts` alone 125 ms;
a CPU profile of `todo --project nzila ls` spends ~40 ms in `node:path`
module resolution with no `src/` caller. A `bun build src/cli/bin.ts
--target=bun --minify` bundle prints the same output for `ls`, `next --json`,
`--project nzila ls` and `ls --all`, and halves every command (best of 5):

| command                 | source | bundle |
| ----------------------- | ------ | ------ |
| `todo --help`           | 159 ms | 72 ms  |
| `todo ls` (this list)   | 195 ms | 100 ms |
| `todo --project nzila ls` | 157 ms | 73 ms  |
| `todo ls --all`         | 156 ms | 73 ms  |

Add a `build:cli` script that bundles `src/cli/bin.ts` to `dist/`, point
`bin.todo` at it and build it on install (`prepare`), so a git install
gets it; `bun src/cli/bin.ts` stays the way to run from source. The bundle
currently copies a 1.58 MB `resolver.darwin-arm64-*.node` asset from the web
dependencies: mark that package external so the bundle stays portable and
`todo web` still loads the server lazily. `--bytecode` was tried and does not
build (ESM needs `--compile`, and `--compile --bytecode` fails), so leave it out.

Done when: `todo --help` from the installed bin runs in under 80 ms warm,
a test pins that the bundled and source CLIs print the same output for
`ls`, `next --json` and `ls --all`, and `bun run check` passes.
