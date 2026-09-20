---
title: Rewrite board and task pages on ui components
tags: [web]
depends_on: [28]
---
M3 page rewrite, first slice (plan: docs/superpowers/plans/2026-09-20-m3-todo-md-adoption.md, item 4).

`TaskRow` (Row/Grid, Text, Badge, `data-next`, move forms with aria-labels), add-form fields (inline for now — the dialog comes with task 31), task metadata/transitions/comment/move/remove-link, `syncStatusBadge` as a ui `Badge` node (`statusTone` stays pure), markdown wrapper nodes. Keep capability gating and the preserved assertions in the plan's Validation Plan.

Done when: `test/web/contracts.test.ts` is green, with markup changed only where the plan says so deliberately.
