---
title: Memoize each project's overview in the hub until its source reports a change
tags: [perf]
---
## Why

xonton reads the whole queue through `Hub.overview` several times per page:
the shell's sidebar, the page itself, live-frame reloads, and one projection
per open `/live` stream. Each read lists every task and done file, reads them
all, and hashes each one to look it up in the parse cache. With about 440
files (3.4 MB) across six lists, one read costs about 80 ms of CPU, and a
page still spends about 350 ms on it.

xonton's architecture keeps it from holding a private task cache
(`docs/architecture.md`, milestone 5 §4): if a read needs one, the owning
library provides it. The parse-cache fix for overlapping reads (9dc7291)
removed the collapse under concurrency; this task removes the repeated work.

## What

- `Hub.overview` (and `dashboard`) reuse a project's last result until that
  project changes, instead of reading and hashing every file again.
- Invalidation comes from the hub's own signals: the source's `changes`
  stream for sources that watch, and the hub's own writes (`notifying`) for
  the rest. A write through the hub is visible to the next read at once,
  with no wait for a watcher event.
- The memo is valid only while the project is watched. With no watcher
  running (nothing subscribed to `changes`), reads go to disk as today.
- A watcher that stops (`stopped watching <project>`) drops the memo for
  that project, so a dead watcher never serves stale data.
- Concurrent reads of the same project share one read in flight.

## Done when

- A second `overview` with no change in between does no file reads (test
  over the fs source with a counting `Files`).
- An edit made on disk is visible after its change event; an edit through
  the hub is visible to the very next read.
- xonton `/` with a warm memo renders in well under 100 ms on the current
  lists (measure as in xonton's `docs/architecture.md` table).
