---
title: Editing one hub registry entry reformats the others
tags: [bug, hub]
---
Found by the controller's post-land review of todo-md:68 (landed `95e9c79`). review#1 noted that `rename` rewrites `{source: memory}` as `{ source: memory }` and called it minor. It is larger than that: every registry edit reformats every entry, including the ones it never touched.

Evidence (scratch at `95e9c79`, own `HOME` and `TODO_MD_HOME`):

- `projects.yaml` = `# mine\nprojects:\n  a: {source: fs, path: <a long path>} # c\n  b: {source: fs, path: <a long path>}\n`. `todo projects rm b` exits 0 and removes `b`. It also rewrites `a`, which nobody edited, from one line into a five-line flow map (`a:\n    {\n      source: fs,\n      path: …\n    } # c`), because the entry is longer than `yaml`'s default `lineWidth` of 80.
- A short flow map gains padding: `{source: memory}` becomes `{ source: memory }` (review#1's probe, `rename`).

`write` in `src/hub/registry.ts` re-serializes the whole document with `doc.toString()`. The module comment says only "comments and order survive", so this is a gap in what an edit keeps, not a contradiction. But a person's hand-written registry should not change layout on lines the command did not touch.

#### What to build

1. Pick one and state it. (a) Keep the `toString` path and pass options that keep each node as parsed (`lineWidth: 0`, `flowCollectionPadding: false`, and whatever else the probe shows), so untouched lines come back byte-identical for the layouts the tests cover. (b) Splice: take the text from the source ranges of the nodes an edit touches, as the Markdown writer does (spec §2.10). (a) is the smaller change; (b) is the only one that holds for every layout.
2. The README's registry bullet says what an edit keeps.

#### Tests first

- `test/hub/registry.test.ts`: a registry with a flow-map entry over 80 columns, a padless flow map and a trailing comment. `delete` of a different entry leaves those lines byte-identical. The same for `rename` and `add`.

#### Done when

Removing, renaming or adding a registry entry leaves every other entry's lines as written, at least for the layouts the tests cover.

#### Out of scope

Task-file frontmatter, which already splices. Error messages (71).
