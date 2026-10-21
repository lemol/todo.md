---
title: The fs watch test that skips git's directory is flaky under load
tags: [test, flake]
---
`test/hub/fs.test.ts` › `skips what a caller's ignore rejects, such as git's
own directory` failed once in two `bun run check` runs on main `a1df35a`
(2026-10-21, load average ~8, other gates live): `(fail) fsSource.changes >
skips what a caller's ignore rejects, such as git's own directory
[1239.83ms]`. It passed in the rerun and in 3 of 3 isolated runs of the
file. That failure's message was not captured.

A likely cause, not proven: under load, FSEvents delivers the probe's or the
settling write's event more than 300 ms late. It then lands in the 500 ms
window that asserts the `.git` write fired nothing.

Build: first capture the failing assertion. Run the file with
`--rerun-each 50` while the machine is loaded, for example with a second
`bun run check` running. Then make the assertion insensitive to late events
from earlier writes, for example by checking which path fired, without
lengthening the windows. The sibling test `emits once per burst …` uses the
same arm-then-settle pattern, so check it too.

Done when: the cause is named, with the failing message as evidence, and
the reviewer sees `bun test test/hub/fs.test.ts --rerun-each 50` pass under
the same load.
