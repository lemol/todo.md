## Goal

Adopt `@lemol/ui` in `src/web` (task 25, M3), completely: delete the hand-rolled UI, rebuild the pages on `mini` (theme, `Document`, `AppShell`, `Nav`, states) plus `@lemol/ui/remix` components, and add the UX the app lacks — starting with dialogs. todo-md becomes the reference look and implementation of the `mini` design. Toasts, the live filter bar and the command palette are specified as M3b follow-ups blocked on ui M2, which has not been built yet.

## Success Criteria

- `src/web/app/ui/styles.css` is deleted; every page renders on `mini` (`miniTheme`, `Document`, `AppShell`, `Nav`, states) plus `@lemol/ui/remix` components, with only small named accommodations where the current UI taught something worth keeping.
- Add, edit and move forms open as native dialogs; every existing route keeps working and every form still submits with no JavaScript.
- `bun run check` is green, including the extended boundaries test and the new accommodation/dialog/no-JS coverage.
- Task 25 closes; the M3b follow-ups exist as tasks blocked on ui M2.

## Context And Current Facts

**What exists today.** `src/web/app/ui/` is string templates, not components: `board.tsx`, `task.tsx`, `dashboard.tsx`, `projects.tsx`, `status.tsx`, `groups.tsx` and `secondary.tsx` return HTML strings. Controllers pass them as `content={...}` into `<Document>` (`src/web/app/actions/controller.tsx:86`, `tasks/controller.tsx:62,101,135`, and the dashboard/groups/projects controllers), and `document.tsx:132` renders `<main innerHTML={options.content} />`. Only `document.tsx` is real Remix JSX. `markdown.tsx` sanitizes Markdown to a string; `Flash` (`document.tsx:165`) returns a raw HTML string.

**The look changes.** The editorial look (`styles.css`, 444 lines: `#FBFBFA` canvas, serif headings, 760px measure, monospace badges) is retired, not preserved. The app takes mini's look — warm-grey neutrals, deep teal accent, 72rem measure, `dark` + `compact` axes — with small accommodations only where justified (see D4). Task 25 was rewritten on 2026-09-20 to say this, after its first version had specified keeping the editorial look as a theme.

**The packages are not three packages.** Task 25's first version named `@lemol/ui-design`, `@lemol/ui-remix`, `@lemol/ui-remix-mini` (fixed in the rewrite); `@lemol/ui` ships as one root package with subpath exports (`./design`, `./design/css`, `./remix`, `./remix/compat`, `./remix/runtime`, `./remix/demos`, `./mini`, `./mini/document`) — Bun git dependencies install the repo root only (ui `docs/architecture.md`, "The shipping shape"). Tag `ui@0.1.0` exists in the ui checkout and on the remote (verified 2026-09-20: same tag object `b73ab3b` both sides). Siblings consume each other as `git+ssh://git@github.com/lemol/<repo>.git#<tag>`. `remix` matches on both sides (`3.0.0-rc.2`).

**M2 does not exist yet.** `Toaster`, `CommandPalette`, `LiveForm` (`--live-submit`), `Table` and the rest of the catalogue are specified in the ui architecture spec's M2 list, but the ui backlog holds only an open "Plan M2" task (M1 itself still has the open playground task 19). What ships today: `Button`, `LinkButton`, layout (`Stack`/`Row`/`Grid`/`Container`), type (`Heading`/`Text`/`Eyebrow`), `Field`, `Badge`, `Dialog` + `overlay()`, `ThemeStyle`, compat, runtime, and `mini` (theme, `Document`, `AppShell`, `Nav`, states).

**The ui-side "Plan M3" task is already done** (`ui/todo/done/m3-todo-md-adoption/03-plan-m3-todo-md-adoption.md`, completed 2026-09-20); its output was the first version of the task-25 file. This plan is the implementation breakdown it deferred.

**Client/asset facts.** The only browser entry is `app/actions/public/entry.ts` (SSE live-refresh + select autosubmit). The asset server allows `app/ui/styles.css`, `app/**/public/**` and package `remix` (`assets.ts:85-86`); `packageContainers` mounts only remix's own dependency closure, so `@lemol/ui` needs its own mount. SSR renders `.tsx` directly under Bun — only the browser entry graph goes through the asset server.

## Constraints And Non-goals

- `AGENTS.md:71` ("This repo stands alone") narrows to the core; only `src/web` may depend on `@lemol/ui`. Architecture doc and boundaries test change together (repo rule).
- Preserve: POST/303 forms, `/events` SSE refresh with dirty-form downgrade, per-project capability gating, board ↑/↓ buttons (M2 explicitly keeps them), `data-live-region` / `data-project` / `data-live-events` / `data-next` attributes, aria-labels on moves, flash texts, status codes and redirect targets.
- No local toast/palette/filter components that duplicate imminent M2 work (see D5).
- No changes to `spec`, `markdown`, `core`, `fs`, `hub`, `git`, `jira`, `cli` semantics; no Jira web wiring (task 24's scope).

## Key Decisions

- **D1 — Depend on `@lemol/ui` (one package, subpath exports).** `"@lemol/ui": "git+ssh://git@github.com/lemol/ui.git#ui@0.1.0"` in `package.json`, following the sibling pattern. `webPackages` gains `"@lemol/ui"` (the checker's prefix rule covers all subpaths). The three package names in task 25's first version do not exist and cannot resolve (fixed in the rewrite).
- **D2 — Render nodes, not strings.** ui components are `Handle` functions styled by `css()` blocks collected during remix's render; the string pipeline cannot host them. Each `*Page` template becomes a node-returning component; `content: string` + `innerHTML` goes away (first work item is a spike proving the pattern on one page). `markdownHtml` stays a string sanitizer embedded via `innerHTML` on a wrapper node — ui has no Markdown component.
- **D3 — Adopt the whole shell: `Document`, `AppShell`, `Nav`, states.** Pure-mini composition first. Two known gaps for the spike: `<main id="main">` takes no `data-live-*` attributes (fixed at `shell.tsx:171`) — expect a live-region wrapper inside `<main>`, which needs no upstream change since entry.ts replaces whatever carries `data-live-region` — and `Nav` items carry no badges (the Check-link diagnostics badge). Each gap gets either a small upstream accommodation in `@lemol/ui` — filed as a task in the ui package's own backlog — or a minimal local one; the spike names which, and task 28 justifies every local deviation. A from-primitives fallback shell exists only if upstream review would block M3a.
- **D4 — Use `miniTheme`, accommodated only where justified.** No editorial theme. `src/web/app/ui/theme.ts` is `miniTheme` plus, if the spike finds anything worth carrying over, a small `extendTheme(miniTheme, …)` with literal override keys — each override named and justified in task 28, and pinned by a test asserting the override set is exactly that list, so the adoption cannot silently drift into a fork. Rejected: a full own theme (contradicts the reference-implementation goal); using mini values verbatim where they are wrong for the app (the escape hatch exists to be used, sparingly).
- **D5 — Phase around missing M2: M3a now, M3b blocked on ui M2.** Dialogs ship (M1) — build them now. Toasts, live filter (`--live-submit`) and command palette (`--palette`) need unbuilt M2 components; building them in todo-md would fork the design system. M3a restyles flash and the filter bar with shipped components and files M3b tasks blocked on ui M2. Rejected: blocking all of M3 on M2 (stalls indefinitely), and local duplicates (splits the system).
- **D6 — Dialogs for add/edit/move; keep every route.** No-JS and deep links stay working: the add dialog lives on the board (no add-GET route exists today); edit gets a dialog on the task page while `GET :id/edit` keeps rendering the same full-page form; move gets a dialog on the task page while board ↑/↓ stay inline. Remove-confirm stays its own page (tests assert its 400/422 flows). 422 re-renders must reopen (or inline) the dialog — the spike settles the mechanism, since `DialogPanel` has no `open` prop.
- **D7 — Wire `compat`, skip `runtime` for now.** One side-effect import (`@lemol/ui/remix/compat`) in `entry.ts` keeps invoker-driven dialogs working below Baseline December 2025. `runtime` registers zero commands today, so it waits for M3b. Asset server: `allowPackages` gains `@lemol/ui`, mounts gain the ui container, `allowFiles` drops `styles.css`.
- **D8 — Projects table stays native for now.** No `Table` until M2; keep `<table>` styled from theme primitives, adopt ui `Table` in M3b.

## Recommended Approach

Wire the dependency first (unblocks everything), then a one-page render spike that settles the D3/D6 open points, then theme + shell, then page rewrites in two slices (board+task, dashboard+projects+secondary), then dialogs + asset wiring, then test closeout and docs. Each slice keeps `bun run check` green before moving on. Implementation reads `.agents/skills/remix/SKILL.md` and the ui `design-system.md` / `interactivity.md` docs before writing components.

## Work Plan

Each item becomes a todo task on creation (titles below); task 25 stays open as the umbrella and closes when 26–32 land.

1. **26 — Wire `@lemol/ui` into `src/web`.** Add the git dependency, `bun install`, `webPackages += "@lemol/ui"`, narrow the `AGENTS.md` rule to "The core stands alone … `src/web` … may depend on `@lemol/ui`", update the `src/web` row in `docs/architecture/README.md`. Validation: `bun run check`, `bun test test/boundaries.test.ts`, and a scratch render of one ui component.
2. **27 — M3 render spike: one page on mini (depends on 26).** Convert `CheckPage` (small, static-ish) to nodes inside mini `Document` + `AppShell` + `Nav`; for each shell gap decide upstream accommodation vs minimal local one (D3), plus dialog-open-on-422 (D6) and markdown-embedding; record the pattern in `src/web/README.md`. Timebox: one session. Validation: page renders byte-plausible, existing check assertions pass.
3. **28 — Mini theme + shell adoption (depends on 27).** Wire `miniTheme` (+ the spike's named accommodations, if any), `ThemeStyle`, `AppShell` with project switcher in the `actions` slot, `Nav` (diagnostics badge per the spike's decision), flash banner composed from primitives (mini has no banner; keep it minimal), reload notice, live-region wrapper, error page. Delete `styles.css`. Validation: override-pin test; `ui.test.tsx` shell assertions updated to the new markup.
4. **29 — Board + task pages on ui components (depends on 28).** `TaskRow` (Row/Grid, Text, Badge, `data-next`, move forms with aria-labels), add-form fields (dialog comes in 31; keep inline until then), task metadata/transitions/comment/move/remove-link, `syncStatusBadge` → ui `Badge` node (`statusTone` stays pure), markdown wrapper nodes. Validation: `bun test test/web/contracts.test.ts` green (updated only where markup intentionally changed — see Validation Plan).
5. **30 — Dashboard + projects + done/check on ui components (depends on 28).** Filter form on `Field`/`Row`/`Button`, project sections, flat rows, projects table (native, themed), rename/add forms, refusal banner, `EmptyState`/`ErrorState` where they fit. Validation: dashboard/projects/sync tests green.
6. **31 — Dialogs for add/edit/move + client wiring (depends on 29).** `overlay()` dialogs hosting the three forms, `:id/edit` kept as full-page fallback rendering the same form component, `compat` import in `entry.ts`, asset-server mount + `allowPackages`, `allowFiles` drops `styles.css`. Validation: dialog presence/open tests per page, browser-entry compile test extended to `@lemol/ui`, asset-mounts tests extended, no-JS markup test (dialogs complete with runtime absent).
7. **32 — Test closeout, docs, green check (depends on 30, 31).** Update the breaking assertions (routes, badge classes, textarea value, flash class), add accommodation/dialog coverage, update `src/web/README.md` + `docs/architecture/frontends.md`, manual click-through (board/task/dashboard/projects, dialogs, dark mode, no-JS) against the mini look, full `bun run check`. Closes 25.
8. **33 — M3b: toasts, live filter, command palette, Table (blocked on ui M2).** Adopt `Toaster` for flash, `LiveForm`/`--live-submit` for the dashboard filter, `CommandPalette`, ui `Table` for projects; revisit remove-confirm as a dialog. Filed now, worked when M2 ships.

## Validation Plan

- Gate every slice: `bun run check` (lint + typecheck + tests) and `bun test test/web` for the touched area.
- Preserved assertions (must pass unmodified): form actions, routes/hrefs, flash texts, status codes, redirects, `data-live-*`, `data-next`, move aria-labels, markdown sanitization, `refresh.test.ts`, `localBack`/`statusFor`, capability gating.
- Known breaking assertions (updated deliberately in their slice, never silently): `routes.test.ts:14` (styles.css asset href), `ui.test.tsx:92` (`badge muted sync-status` class), `ui.test.tsx:110` (styles.css link), `dashboard.test.ts:59` (`badge muted` class), `projects.test.ts:52-53,67` (option markup, `span.muted`), `contracts.test.ts:214` (`>…</textarea>` — ui `Field` takes textarea value from `value`), `sync.test.ts:105` (`flash error` class).
- New coverage: accommodation pin (override set is exactly the justified list), dialog trigger/panel ids per page, 422-dialog behavior, no-JS render test, asset compile with `@lemol/ui` in the graph.
- Manual: `bun src/cli/bin.ts web --dir todo`, click through board/task/dashboard/projects, open each dialog, submit each form, toggle dark mode, disable JavaScript and repeat — everything reads as mini. Highest-risk check: the asset server compiling `entry.ts` + `compat` inside a bun-store layout (extend `asset-mounts.test.ts` for it).
- Install check: `bun install` in a fresh checkout resolves `@lemol/ui` from git (tag presence verified 2026-09-20; still needs ssh access at install time).

## Risks / Rollback

- **Dialog open on 422.** `DialogPanel` has no `open` prop. Fallback: 422 renders the form inline/full-page (today's behavior) instead of reopening the dialog. Settled by the spike; worst case is a small upstream prop.
- **Textarea value rendering.** ui drops textarea children; the edit test asserting `>…</textarea>` will change to whatever `Field` emits — verify no-JS correctness of that markup explicitly.
- **Shell gaps.** If `AppShell`/`Nav` cannot host the switcher/badges/live-region cleanly, each gap goes upstream (small accommodation in `@lemol/ui`) or, if upstream review would block M3a, minimal-local with a justification in task 28 — bounded either way.
- **Upstream latency.** Accommodations are filed as tasks in the ui package's backlog and need review there; M3a never waits on them (local fallback keeps every slice shippable), and M3b is already the vehicle for anything deferred.
- **Standalone install.** A git+ssh dependency needs network + credentials at install time; same trade every sibling repo already made. No rollback needed.
- **M2 timing.** M3b waits on another repo's milestone; M3a is fully useful without it. Rollback per slice is `git revert` of that slice's commits; no data migrations involved.

## Open Questions

- **Dialog-open-on-422 mechanism.** Genuinely needs the spike's code, not more reading — answered by task 27.

## Todo Tasks (created after approval)

Eight tasks in group `M3 — @lemol/ui adoption`, each its own file, with `depends_on` as listed in the Work Plan (26 none; 27→26; 28→27; 29,30→28; 31→29; 32→30,31; 33 none, body notes "blocked on ui M2"). Task 25 stays open as the umbrella (already rewritten to the mini-complete direction, with a pointer to this plan) and closes with task 32. Creation command per task: `bun src/cli/bin.ts add "<title>" --group "M3 — @lemol/ui adoption" --description - --depends-on <ids> --tag web`.
