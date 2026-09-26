# Decision log

| Decision                                   | Why                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| One spec with model + format parts         | Adapters like Jira need the abstract model; the file format stays the concrete, canonical face. |
| Stable sequential IDs, opaque in the model | Short to type and stable for `depends_on`; Jira keys fit the same slot.              |
| Inline tasks with a metadata line          | Quick one-liners stay in `TODO.md`; the title line stays free of metadata syntax.    |
| Completed tasks become files in `done/`    | History stays browsable; `TODO.md` shows only open work.                             |
| Groups map to directories by convention    | The folder layout mirrors `TODO.md`; parsers stay lenient about hand-placed files.   |
| Comments as `###` headings in task files   | Comments are free-form Markdown; headings avoid the indentation traps of list items. |
| mdast for reading, splicing for writing    | A well-tested parser, plus minimal diffs that re-serialization can't give.           |
| Separate pure `markdown` module            | Reusable in the browser and by other file-based adapters.                            |
| One package with subpath exports           | Git dependencies install only the root package; an umbrella over workspace packages fails at runtime. |
| Boundaries enforced by a test              | Keeps the module graph as strict as separate package manifests would.                |
| `effect` as an exact peer dependency       | One shared copy of `effect` across all lemol repositories.                           |
| `bun test` instead of vitest               | Zero config; the helper we lose is about 20 lines.                                   |
| Fine-grained contract, no cache            | Maps to remote APIs; always sees hand edits.                                         |
| Parses cached by content, not a database   | Parsing, not I/O, made large lists slow. A cache keyed by file text is exact after any hand edit; a synced index would need a watcher running to stay right. |
| Remix 3, local server first                | The first web UI is a private Bun server over one filesystem list; server-rendered forms keep the app useful without JS. |
| A `hub` library, not a server              | The CLI, web app and TUI share project logic in-process; no daemon to run or secure. `server-core` would have suggested HTTP. |
| Sources injected into the hub              | The hub never imports git or jira; new or third-party sources are values passed at the composition root. |
| An explicit project registry               | `~/.todo-md/projects.yaml`, managed from the CLI and web. Auto-registering fills it with throwaway lists; scanning is slow and implicit. |
| Local replicas and explicit `sync`         | Reads stay fast and offline: the directory (fs), a clone (git), a JSON mirror (jira). Remote data refreshes only on `sync`. |
| JSON mirrors, no SQLite yet                | Mirrors are small and disposable, so switching later is a re-sync. A global index would go stale on every hand edit. |
| Git: commit per mutation, then try to push | Changes reach other machines at once; a failed push leaves the commit local and visible as `ahead`, never a failed mutation. |
| Jira: mirror plus daily actions            | Complete, reopen, comment, title and labels; no issue creation or deletion, no Markdown → ADF. |
| `add` and `remove` become capabilities     | Lets a source such as Jira leave them out (spec §1.5). |

Hosting the web app with GitHub-backed storage and authentication remains
follow-up work (task 09), building on the hub and the git source.
