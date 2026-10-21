---
title: Keep the installed todo bin current with the checkout
tags: [cli]
---
todo-md:46 (`86f8909`..`483d4af`) pointed `bin.todo` at `./dist/bin.js`,
which is gitignored and built only by `prepare`. On this machine that leaves
three gaps. None of them is pinned, and installs are not allowed in a run,
so nobody has verified them.

Evidence (2026-10-21, main `a1df35a`):

- The main checkout has no `dist/`. `lemol-workspace/node_modules/.bin/todo`
  and `repos/nzila/node_modules/.bin/todo` still link to
  `src/cli/bin.ts`, from installs made before the land. The next install
  relinks them to `dist/bin.js`.
- `lemol-workspace`'s store copy
  (`node_modules/.bun/@lemol+todo-md@file+repos+todo-md+…`) holds neither
  `dist/` nor `scripts/`. Whether Bun runs a `file:` or `workspace:`
  member's `prepare` is unverified.
- Even when built, `dist/` is not rebuilt by `git pull`, a land, or a
  checkout. The installed `todo` then runs old code, while the external
  `src/web/app/assets.ts` it loads comes from the current tree.
  `scripts/build-cli.ts` never empties its outdir, so a rebuild after a
  source change leaves the old `chunk-*.js` files beside the new ones.

Decide and build (the person decides between the two, the rest follows):

1. Either the bin checks that its bundle is current and falls back to
   source, or a small checked-in `bin` entry runs `dist/bin.js` when it
   exists and `src/cli/bin.ts` otherwise. Name the cost of the check
   against todo-md:46's 80 ms help budget.
2. `build:cli` empties its outdir before building.

Tests first: in `test/cli/bundle.test.ts`, a rebuild after removing an
entry leaves only the new outputs, and the installed entry runs with no
`dist/`.

Done when: those tests pass. A person runs `bun install` in
`lemol-workspace` and confirms `node_modules/.bin/todo --help` works.
Out of scope: publishing to a registry.
