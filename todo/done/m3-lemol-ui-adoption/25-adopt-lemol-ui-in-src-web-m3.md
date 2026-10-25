---
title: Adopt @lemol/ui in src/web (M3)
tags: [web]
group: M3 — @lemol/ui adoption
completed_at: 2026-09-20T18:34:44Z
outcome: completed
---
Adopt `@lemol/ui` in `src/web`, completely. todo-md becomes the first real consumer and the reference look and implementation of the `mini` design: its web UI is rebuilt on `mini` (theme, `Document`, `AppShell`, `Nav`, states) plus `@lemol/ui/remix` components. The current hand-rolled UI is not kept — no editorial theme, no carried-over look. Where the current UI teaches something worth keeping, accommodate `mini` for it (preferably upstream in `@lemol/ui`); the result stays recognizably mini.

Full spec: `docs/superpowers/specs/2026-09-17-lemol-ui-architecture-design.md` in the ui repository (not inside this repo).
Implementation plan: `docs/superpowers/plans/2026-09-20-m3-todo-md-adoption.md`.

## Rule changes in todo-md

Its `AGENTS.md` currently forbids this outright. Narrow the rule to the core:

    - **This repo stands alone.** It must not depend on other lemol repositories.
    + **The core stands alone.** spec, markdown, core, fs, hub and cli must not
    + depend on other lemol repositories. `src/web` is a composition root and
    + may depend on `@lemol/ui`.

And extend the web allowlist in `test/boundaries.test.ts`, which asserts `web must not import <anything not listed>`:

    const webPackages = [ ...,
    +  "@lemol/ui",
    ]

(`@lemol/ui` is one package with subpath exports — `./design`, `./remix`, `./mini`, … — not three packages; the checker's prefix rule covers the subpaths.)

## Work

Delete `src/web/app/ui/styles.css`. Rewrite `src/web/app/ui/*.tsx` on `mini` + `@lemol/ui/remix`, rendering nodes instead of HTML strings. Add the UX it lacks — dialogs for the add/edit/move forms now; toasts, a live filter bar and a command palette follow ui M2 (`Toaster`, `LiveForm`, `CommandPalette` are not built yet).

Preserve what already works: POST/303 forms, the `/events` SSE live-refresh with `shouldRefresh` downgrading to a notice when a form is dirty, per-project capability gating (a project without `groups` or `comments` hides that UI), and the up/down reorder buttons.

This task is the umbrella; the implementation is tracked by follow-up tasks in this group (see the plan's Work Plan).

