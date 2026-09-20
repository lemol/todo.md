---
title: "M3 render spike: one page on mini"
tags: [web]
depends_on: [26]
group: M3 — @lemol/ui adoption
completed_at: 2026-09-20T07:03:57Z
outcome: completed
---
M3 spike (plan: docs/superpowers/plans/2026-09-20-m3-todo-md-adoption.md, item 2). Timebox: one session.

Convert `CheckPage` (small, static-ish) to nodes inside mini `Document` + `AppShell` + `Nav`. For each shell gap (live-region attrs on `main`, `Nav` badges, …) decide: upstream accommodation filed as a task in the ui package's own backlog, or minimal local one. Also settle dialog-open-on-422 and markdown-embedding. Record the pattern in `src/web/README.md`.

Done when: the page renders and the existing check assertions pass.
