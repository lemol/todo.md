---
title: A test run leaves its temporary directories behind
tags: [test, cleanup]
---
The todo-md:53 controller review (loop `01M5FHVVJ6H539ZGYMN78TTRXJ`, main
`67e4a6b`) counted the `todo-md-*` directories under `$TMPDIR`: 1130 before
one `bun run check` and 1141 after it. One run of the suite leaves eleven:

```
5 todo-md-test-home-*      test/sandbox.ts
4 todo-md-add-*            test/web/projects.test.ts
1 todo-md-cwd-*            test/web/projects.test.ts
1 todo-md-web-git-*        test/web/projects.test.ts
1 todo-md-register-*       test/web/dashboard.test.ts
1 todo-md-load-*           test/web/load.test.ts
1 todo-md-git-templates-*  test/git/helpers.ts (when the git tier runs)
```

The 1130 already there: 783 `test-home`, 140 `add`, 37 `git-templates`,
35 each of `web-git`, `register` and `cwd`, 9 `load`. Every gate of every
run adds to it, on every machine that runs the suite.

Two causes:

1. `test/sandbox.ts` and `test/git/helpers.ts` remove their directory in a
   `process.on("exit", …)` handler, and `bun test` (1.4.3) does not fire
   it. Probe: a test file whose `exit` handler writes a marker file, run
   with `bun test`; the marker is never written.
2. The web tests `mkdtempSync` a directory and never remove it (the
   todo-md:52 review noted this for `load.test.ts` and filed nothing).

Build:

1. Remove each directory by a hook `bun test` does run: `afterAll` in the
   preload for the sandbox home, which runs once per test file, so it needs
   to remove the home after the last file and not before. Or another hook
   that is proven to run. Spawned processes inherit `TODO_MD_HOME`, so
   remove the home only after the whole run.
2. Give the web tests' directories a cleanup (`afterEach`/`afterAll`, or a
   scoped temporary directory like `diskWith`'s).
3. Do not remove directories the run did not create. Other runs on the same
   machine use the same prefixes at the same time (see todo-md:53).

Tests first: a test that runs `bun test` on a small fixture with the
sandbox preloaded, in its own `TMPDIR`, and finds no `todo-md-*` left in
that `TMPDIR` afterwards. It fails today.

Done when: that test passes. Reviewer's check: one `bun run check` with
its own empty `TMPDIR` leaves no `todo-md-*` directory behind, and two
`bun run check` runs at once in one shared `TMPDIR` both pass, so neither
run removed the other's directories.

Out of scope: deleting the directories that are already there. That is
the person's job, and other live runs may still be using some of them.
