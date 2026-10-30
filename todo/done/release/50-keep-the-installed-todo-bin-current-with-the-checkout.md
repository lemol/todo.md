---
title: Keep the installed todo bin current with the checkout
tags: [cli]
group: Release
completed_at: 2026-10-30T18:26:02Z
outcome: completed
---
todo-md:46 (`86f8909`..`483d4af`) pointed `bin.todo` at `./dist/bin.js`,
which is gitignored and built only by `prepare`. On this machine that leaves
three gaps. None of them is pinned, and installs are not allowed in a run,
so nobody has verified them.

Evidence (2026-10-21, main `a1df35a`):

- The main checkout has no `dist/`. Consumers' `node_modules/.bin/todo`
  links still point at `src/cli/bin.ts`, from installs made before the
  land. The next install relinks them to `dist/bin.js`.
- A consumer's store copy (`node_modules/.bun/@lemol+todo-md@file+…`)
  holds neither `dist/` nor `scripts/`. Whether Bun runs a `file:` or `workspace:`
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

Done when: those tests pass. A person runs `bun install` in a consumer
and confirms `node_modules/.bin/todo --help` works.
Out of scope: publishing to a registry.

## Comments

### @codex at 2026-10-30 18:26:01 +00:00

At the user's request, created disposable consumer projects and ran real bun install checks with Bun 1.4.4, isolated HOME and TODO_MD_HOME. The package was copied from this working checkout so all uncommitted task-50 changes were included.

file:../todo-md: install succeeded (251 packages); node_modules/.bin/todo links to bin/todo.ts and --help succeeds with no dist. Explicitly building the installed package succeeded and bundleIsCurrent returned true. Editing installed source while retaining the bundle proved that the installed launcher used source; source was restored afterward. The installed CLI completed init, add, next --json and done successfully.

workspace:*: install succeeded (250 packages); Bun ran the member's prepare/build, creating dist and freshness metadata. The consumer's node_modules/.bin/todo --help succeeded and bundleIsCurrent returned true.

Temporary samples retained at /var/folders/yf/tsckr3ss2_scxcnl3lwn90vr0000gn/T/todo-md-consumer-6wvj8aqz (consumer/ and workspace/consumer/). These install checks satisfy the previously pending consumer validation. The optional 80 ms performance budget remains unmet on this machine, as recorded above.

### @codex at 2026-10-30 18:19:57 +00:00

Implemented the chosen freshness-check option: the checked-in bin/todo.ts uses the bundle only when its source/config/lockfile content fingerprint matches and all output chunks exist; otherwise it imports the source CLI. build:cli clears its outdir and records freshness metadata. Tests cover no dist, stale inputs (including preserved timestamps, additions/removals and lockfile changes), missing/invalid metadata, missing chunks, current-bundle selection and removal of obsolete chunks on rebuild.

Validation: bun run check passed (1494 pass, 128 skip, 0 fail), including the bundle regression tests. Code review found no substantive issues. Bun 1.4.4 timing: warm fingerprint median 4.52 ms over 30 samples; latest best-of-five help was 241.21 ms through the launcher versus 245.99 ms directly. Process timing noise obscures the incremental overhead; both exceed the existing optional 80 ms benchmark, which still fails and was not relaxed.

Still open for the required person-run consumer check: run bun install in a consumer, then confirm node_modules/.bin/todo --help works. No installs were performed in this run.
