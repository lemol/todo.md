---
title: An unresolved alias in the hub registry crashes every command
tags: [bug, hub]
---
Found by the controller's post-land review of todo-md:65 (landed `318d1ca`). 65's brief put the registry out of scope because it "reads with `doc.get`, not `toJS()`", but `entries` in `src/hub/registry.ts` maps each project with `pair.value.toJS(doc)`. `read` checks `doc.errors`, and the `yaml` library reports no error for an alias to a missing anchor; `toJS` throws instead ("Unresolved alias (the anchor must be set before the alias)"; also "Excessive alias count indicates a resource exhaustion attack").

Evidence (scratch at `318d1ca`, own `HOME`; `$TODO_MD_HOME/projects.yaml` = `projects:\n  p: *a\n`): `todo --dir <a good list> list` exits 1 with `ERROR (#2): ReferenceError: Unresolved alias …` and a stack through `registry.ts` `entries` (`at map`) and `src/cli/commands/query.ts`. Even with `--dir`, one hand-edited registry line makes every listing command unusable, and the throw is a defect, not a `RegistryError`.

#### What to build

1. `entries` (and any other `toJS` on registry nodes) turns a throw into a `RegistryError` naming the file and the message's first line, as `read` does for parse errors. Prefer doing it once in `read` (for example a `toJS` check of the whole document) so every caller sees it.
2. Decide whether a command given `--dir` needs the registry at all; if it does not, it should not fail on a bad registry. State the choice; if the change is larger than this task, file it rather than doing it.

#### Tests first

- A registry `projects:\n  p: *a\n` makes `entries` fail with `RegistryError` (not a defect), its message naming `projects.yaml` and `Unresolved alias`.
- The same for an alias bomb.
- A registry with a resolving alias (`base: &b {path: /x}` reused by two projects, if the schema allows) still reads.
- A CLI test: `todo projects ls` with the bad registry exits 1 with the error line and no stack trace.

#### Done when

No registry text makes a `todo` command die with an uncaught exception.

#### Out of scope

Task-file and `TODO.md` frontmatter (65, 66).
