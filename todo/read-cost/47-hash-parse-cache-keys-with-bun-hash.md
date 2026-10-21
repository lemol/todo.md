---
title: Hash parse-cache keys with Bun.hash
tags: [perf]
---
Every process hashes the full text of every file in the list to build the
parse-cache key (`keyOf`, `src/fs/parsing.ts`), in JavaScript (cyrb53). On
nzila's list (596 files, 4.7 MB) that is 9.6 ms cold per command; `Bun.hash`
over the same texts takes 2.0 ms. In a CPU profile of
`todo --project nzila ls`, `hash` is the largest piece of real work (~18 ms
with profiler overhead), ahead of parsing `TODO.md`.

Use `Bun.hash` for `keyOf`. The key format changes, so existing cache files
miss once and are rewritten; no version bump is needed since a miss only
re-parses. Keep cyrb53 (or anything stable) for the cache file name, which
`forgetGone` relies on. (The sandbox guard no longer watches `cache/`, since
48.) The cache stays never a source of
truth: an identical text at the same path is still the only reuse.

Done when: `keyOf` over a 600-file, ~5 MB list costs under 3 ms cold,
`todo list` output is unchanged, and `bun run check` passes.

Depends on nothing; measure after "Ship the todo CLI as a bundle" lands, since
startup otherwise hides the gain.
