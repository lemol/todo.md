---
title: Import a Markdown list into a SQLite project
depends_on: [40]
---
Follow-up to "Add the SQLite source" (task 40). Design: [SQLite source design](../../docs/superpowers/specs/2026-10-19-sqlite-source-design.md).

A new SQLite list starts empty. Add a way to fill one from an existing Markdown list — for example `todo projects add --source sqlite --from <dir>` — copying tasks, groups, comments, done tasks and their IDs through the two `TodoStore`s, so a real list can move to a database file on day one.

Done when: the import copies an fs list into a sqlite project with IDs, groups, ordering, comments and done tasks preserved, the CLI help covers the new flag, and tests cover the copy.
