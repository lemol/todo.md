---
title: Adopt @lemol/ui in src/web (M3)
tags: [web]
---
Plan todo-md's adoption of the UI packages. Full spec: `docs/superpowers/specs/2026-09-17-lemol-ui-architecture-design.md`.

todo-md becomes the first real consumer. Its web UI today has a 444-line `src/web/app/ui/styles.css` and its own `ui/` layer (`board`, `dashboard`, `task`, `status`, `groups`, `projects`, `markdown`, `secondary`, `document`), with no dialogs and little interactivity. Adopting `mini` should be a visible upgrade, not a reskin.

## Rule changes in repos/todo-md

Its `AGENTS.md` currently forbids this outright. Narrow the rule to the core:

    - **This repo stands alone.** It must not depend on other lemol repositories.
    + **The core stands alone.** spec, markdown, core, fs, hub and cli must not
    + depend on other lemol repositories. `src/web` is a composition root and
    + may depend on `@lemol/ui-*`.

And extend the web allowlist in `test/boundaries.test.ts`, which asserts `web must not import <anything not listed>`:

    const webPackages = [ ...,
    +  "@lemol/ui-design", "@lemol/ui-remix", "@lemol/ui-remix-mini",
    ]

## Work

Delete `src/web/app/ui/styles.css`. Rewrite `src/web/app/ui/*.tsx` on `ui-remix` + `mini`. Add the UX it lacks — dialogs for the add/edit/move forms, toasts for flash messages, a live filter bar, a command palette.

Keep its light editorial look as a theme: light canvas (`#FBFBFA`), serif headings (Iowan Old Style / Charter), a 760px measure, monospace badges, hairline borders, and its `prefers-color-scheme: dark` variant. That look is the opposite end of the range from mionso's dark amber, which is exactly what makes todo-md a real test of the token contract rather than a friendly one.

## Check before planning the rewrite

`src/web/app/ui/document.tsx` renders `<main innerHTML={options.content} />` from pre-rendered HTML strings, and `Flash` returns a raw HTML string. Work out how component rendering composes with that — it may want changing to render nodes directly — before planning the individual tasks.

Also preserve what already works: POST/303 forms, the `/events` SSE live-refresh with `shouldRefresh` downgrading to a notice when a form is dirty, per-project capability gating (a project without `groups` or `comments` hides that UI), and the up/down reorder buttons.
