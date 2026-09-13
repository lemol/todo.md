---
title: Fix TypeScript check failure in conformance assertion
completed_at: 2026-09-13T01:44:33Z
---
`bun run check` fails in `src/spec/testing/conformance/assert.ts:8`: TypeScript rejects the optional `message` argument passed to `node:assert/strict`'s `deepStrictEqual` overload.
