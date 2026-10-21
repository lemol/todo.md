---
title: The sandbox guard fails a test for another process's parse-cache write
tags: [test, flake]
---
`test/sandbox.ts` snapshots the whole real hub home (`~/.todo-md`, or
`$TODO_MD_HOME`) and fails whichever test was running when anything under it
changed. The hub's parse cache lives there (`~/.todo-md/cache/*.json`), and
every real `todo` or nzila process on the machine rewrites it. So a gate that
runs while anything else reads a list fails a test that touched nothing.

Evidence: todo-md:46's check#1 (attempt `01M5FJF8MYD6DS1TF27WW4M2PX`,
output.log line 1634) failed `the git store conforms to TodoStore > listDone
returns the most recently completed task first` with `-`/`~` lines under
`~/.todo-md/cache/`. That test opens the git store with no `cacheDir`
(`test/git/helpers.ts` builds the project without one), so it cannot write
there. The cache files' mtimes fell inside the gate's window, while other
runs were live. The test passes 57/57 alone. It cost the run a `do` resume
(do#2), which had to prove the failure was not its own.

Decide and build: the guard stops counting the real home's `cache/`
directory. The cache is never a source of truth (spec, storage
architecture): a write there edits no one's work, which is what the guard
exists to catch. Keep watching the registry and the rest of the home, and
this repository's `todo/`.

Tests first: in `test/sandbox.test.ts`, a change under `<home>/cache/` is
not reported, while a change to the registry file next to it still is.

Docs: the guard's comment in `test/sandbox.ts` says what it skips and why.

Done when: the two cases above are pinned. Out of scope: moving the cache
out of the hub home; task 47's key format.
