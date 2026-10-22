---
title: An aliased projects map in the hub registry is refused as not a map
tags: [bug, hub]
---
Found by the controller's post-land review of todo-md:67 (landed `6c99e59`). 67's README bullet in `src/hub/README.md` now says an alias to a missing anchor fails reads, "(a resolving alias is fine)". That holds for an entry's value (`q: *b`), not for the `projects` key itself.

Evidence (scratch at `6c99e59`, own `HOME` and `TODO_MD_HOME`):

- `projects.yaml` = `all: &x\n  p: {source: fs, path: <a list>}\nprojects: *x\n`: `todo projects ls` exits 1 with `error: <file>: projects must be a map`. The alias resolves; `read` in `src/hub/registry.ts` checks `doc.get("projects", true)` with `isMap`, and an `Alias` node is not a map. The check predates 67, but the message is wrong for this file and the README sentence is now wrong too.
- Related, same file: with `projects:\n  p: &b {...}\n  q: *b\n`, `todo projects rm p` exits 1 with `error: <file>: Unresolved alias (the anchor must be set before the alias): b`. The refusal is right (67's "deleting an anchor still used by another project refuses the write"), but the message reads as if the file on disk were broken; it does not say the edit is what would leave the alias unresolved.

#### What to build

1. Decide what an aliased `projects` value means. Recommended: refuse it with a message that says so (`projects must be a map, not an alias`), since `editOf` would otherwise edit the anchored map under another key. Accepting it for reads only is the alternative; state the choice.
2. `src/hub/README.md`'s alias bullet says which aliases are fine (entry values) and which are not (`projects` itself).
3. A write refused by `doc.toString()` says the edit would leave an alias unresolved, naming the alias, for example `<file>: removing p would leave alias *b unresolved` or `<file>: the edit leaves an unresolved alias (…): b`. Keep the file unchanged, as today.

#### Tests first

- `test/hub/registry.test.ts`: `all: &x {p: {source: memory}}\nprojects: *x\n` makes `entries` fail with a `RegistryError` whose message is the chosen one (or, if accepted, lists `p`).
- The existing "deleting an anchor still used by another project refuses the write" test asserts the new message and still that the file is unchanged.

#### Done when

No registry message blames the file on disk for what an edit would do, and the README's alias sentence matches what `read` accepts.

#### Out of scope

Task-file frontmatter (66). Nested collection keys inside an entry's value still emit Node's "Keys with collection values will be stringified" warning from `pair.value.toJS(doc)`; it predates 67 (review#2 measured the same six warnings at the base) and is not part of this task.
