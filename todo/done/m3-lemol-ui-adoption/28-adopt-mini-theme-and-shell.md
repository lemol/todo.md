---
title: Adopt mini theme and shell
tags: [web]
depends_on: [27]
group: M3 — @lemol/ui adoption
completed_at: 2026-09-20T07:19:32Z
outcome: completed
---
M3 shell adoption (plan: docs/superpowers/plans/2026-09-20-m3-todo-md-adoption.md, item 3).

Wire `miniTheme` (+ the spike's named accommodations, if any) and `ThemeStyle`; `AppShell` with the project switcher in the `actions` slot; `Nav` (diagnostics badge per the spike's decision); flash banner composed from primitives (mini has no banner — keep it minimal); reload notice; live-region wrapper; error page. Delete `src/web/app/ui/styles.css`. Justify every local deviation from mini, and pin the override set with a test asserting it is exactly that list.

Done when: the override-pin test is green and the `ui.test.tsx` shell assertions are updated and green.
