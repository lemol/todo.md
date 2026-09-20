---
title: Dialogs for add, edit and move plus client wiring
tags: [web]
depends_on: [29]
---
M3 dialogs (plan: docs/superpowers/plans/2026-09-20-m3-todo-md-adoption.md, item 6).

`overlay()` dialogs hosting the add, edit and move forms; `GET :id/edit` stays as the full-page fallback rendering the same form component; side-effect `compat` import in `entry.ts`; asset-server mount + `allowPackages` for `@lemol/ui`; `allowFiles` drops `styles.css`. Board up/down buttons stay inline.

Done when: dialog presence/open tests are green per page, the browser-entry compile test covers `@lemol/ui`, the asset-mounts tests are extended, and the no-JS markup test is green.
