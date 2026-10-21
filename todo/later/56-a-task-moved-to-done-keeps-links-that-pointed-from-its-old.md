---
title: A task moved to done/ keeps links that pointed from its old directory
tags: [bug]
---
Seen twice on 2026-10-21 in project1. `todo done` moved `todo/a-session-in-the-app/16-….md` to `todo/done/a-session-in-the-app/16-….md`, and `todo/planning-in-the-app/03-….md` to `todo/done/planning-in-the-app/03-….md`. Each move goes one directory deeper. The task bodies' relative links, such as `../../product/projects/…/README.md`, were written from the old directory, so after the move they point one level short. project1's `check-docs` then reported them broken. We fixed them by hand (project1 `b4defa8`, `4a5f8ff`). `reopen` makes the reverse move and would break them the other way.

#### Done when

Moving a task file between `todo/<group>/` and `todo/done/<group>/`, by `done`, `cancel` or `reopen`, rewrites its relative Markdown links so they resolve to the same targets. Absolute URLs, anchors-only links (`#…`) and links that did not resolve before the move are left as they are. A test covers a link that resolves before and after `done` and after `reopen`.
