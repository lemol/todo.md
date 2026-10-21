---
title: A hub test's temporary list vanishes under concurrent test runs
tags: [test, flake]
---
The todo-md:51 reviewer (attempt `01M5FTCRMQNB85Q866PVM1QDEF`, main `9401291`)
ran two `bun test test/hub` loops at once beside six CPU burners, and one of 48
runs failed `autoSync > syncs every syncable project one interval after
startup` (`test/hub/sync.test.ts`):

```
error: NotFound: FileSystem.makeTempDirectoryScoped (/var/folders/…/T/todo-md-NkoIpl)
 method: "makeTempDirectoryScoped",
 syscall: "lstat",
ENOENT: no such file or directory, lstat '/var/folders/…/T/todo-md-NkoIpl'
```

Log: `~/.nzila/attempts/01M5FTCRMQNB85Q866PVM1QDEF/proof/loaded-rerun.log.loop1`,
from line 155. The directory is the `diskWith` root (`test/fs/helpers.ts`,
`fs.makeTempDirectoryScoped({ prefix: "todo-md-" })`). Something removed a
temporary directory the test had just made, or one the scope had already
removed. Nobody has found which. Two gates on one machine (concurrent runs of
a loop) is the normal case, so the same failure can fail a gate.

Build:

1. Reproduce it: two or three `bun test test/hub --rerun-each 20` loops at
   once, under load. Record the failing message and the test.
2. Name the cause with evidence. For example: does the `lstat` come from
   creation or from the scope's finalizer? Does any code under test, or
   `test/sandbox.ts`, remove a path under `tmpdir()` that it did not create?
3. Fix the cause, not the window. Do not give a removal a broader glob, and
   do not retry the creation.

Tests first: a test that fails while the cause is in place, for example two
scoped disks whose cleanup orders overlap, or whatever step 2 names.

Done when: the cause is named with the failing message as evidence, and the
fix has a test. Reviewer's check: two concurrent `bun test test/hub
--rerun-each 20` loops under load show no `NotFound` for a `todo-md-`
directory.

Out of scope: the fs watch timing windows (todo-md:51).
