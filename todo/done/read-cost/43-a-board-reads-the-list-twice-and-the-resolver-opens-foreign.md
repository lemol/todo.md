---
title: A board reads the list twice and the resolver opens foreign projects per task
group: Read cost
completed_at: 2026-10-20T06:47:46Z
outcome: completed
---
Since 2026-10-20 a read whose files are all as they were reuses the last snapshot after a stat pass (`fs/snapshot.ts`, `keyOf`), so a 586-file list reads in 8 ms. What is left is structural: `TodoService.board` is `load()` and `listDone()`, two snapshot reads and two stat passes of the same files, and `hub/dependencies.ts` answers `satisfied` by opening the foreign project's service and reading a task at a time, each read its own stat pass. A list of five files whose tasks depend on tasks in two large lists still lists in 33 ms against 8 for one of those lists. Build a board from one snapshot, and let the resolver read the foreign projects' boards once per call. Done when: a list of five files that depends on two 500-file lists reads in under 10 ms warm, and `todo list` output is unchanged.
