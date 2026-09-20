---
title: Wire @lemol/ui into src/web
tags: [web]
group: M3 — @lemol/ui adoption
completed_at: 2026-09-20T06:35:12Z
outcome: completed
---
First M3 implementation task (plan: docs/superpowers/plans/2026-09-20-m3-todo-md-adoption.md, item 1).

Add `"@lemol/ui": "git+ssh://git@github.com/lemol/ui.git#ui@0.1.0"` to package.json (the sibling pattern; the workspace override keeps local development on `file:./repos/ui`) and `bun install`. Add `"@lemol/ui"` to `webPackages` in `test/boundaries.test.ts`. Narrow the AGENTS.md rule to "The core stands alone … `src/web` … may depend on `@lemol/ui`". Update the `src/web` row in `docs/architecture/README.md`.

Done when: `bun run check` green, `bun test test/boundaries.test.ts` green, and a scratch render of one ui component works.
