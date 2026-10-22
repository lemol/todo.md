---
title: An aliased projects map in the hub registry is refused as not a map
tags: [bug, hub]
group: Later
completed_at: 2026-10-22T05:00:18Z
outcome: completed
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

## Comments

### @nzila at 2026-10-22 05:00:18 +00:00

Done: Chose to refuse `projects: *x` on read with "projects must be a map, not an alias" (registry.ts `read`). A failed `doc.toString()` on write now says "<file>: the edit would leave alias *p unresolved"; the file stays unchanged. README alias bullet says entry-value aliases are fine and `projects` itself is not.
Tests: added the aliased-projects case to the "alias failures" table and updated the anchor-delete test's message. Both pass, along with all of test/hub (147 pass). oxlint and tsc are clean.
Gap: I wrote the code and tests together and did not watch the new tests fail first.

Review: approved (5/5)
Approved. I read the whole diff 9217b8e..ce02317: src/hub/README.md (+7 -4), src/hub/registry.ts (+21 -1) and test/hub/registry.test.ts (+2 -1).

What to build:
1. Done. The implementer chose to refuse, and said so. `read` in src/hub/registry.ts returns "projects must be a map, not an alias" when `isAlias(projects)` (registry.ts:136-137, from rg -n). `update` goes through `read` first, so `editOf` never reaches the anchored map.
2. Done. src/hub/README.md:74-78 says a resolving alias is fine as an entry's value (`q: *b`) but not as `projects` itself. That matches `read`.
3. Done. The `write` catch maps `/^Unresolved alias[^\n]*: (.+)$/m` to "<file>: the edit would leave alias *<name> unresolved" (registry.ts:171-179). Every other toString failure still goes to `yamlFailure`. The file stays unchanged.

Tests and Done when:
- An aliased projects map fails `entries`: pinned in test/hub/registry.test.ts:238, in the "alias failures" table. That one row drives two tests: "entries fail with a RegistryError: all: &x {p: {source:" and "update refuses without calling edit: …".
- Anchor delete: pinned by "deleting an anchor still used by another project refuses the write" (:308). It asserts the new message and that the file is unchanged.
- Reversal: in a scratch worktree I put base registry.ts back. 3 tests failed and 19 passed. The two table tests got "projects must be a map" instead of "…, not an alias". The delete test got "Unresolved alias (the anchor must be set before the alias): p".
- "No message blames the file for an edit": I checked this with the CLI probes below.
- "README matches read": item 2 above.
- At HEAD, `bun test test/hub` gives 147 pass, 0 fail.

Comments: the task file todo/later/68-…md is 29 lines. Its only headings are What to build, Tests first, Done when and Out of scope (grep -n "^#"). The brief has no Pre-start task comments section. So there are 0 comments and no authors.

Implementer's gap ("did not watch the tests fail first"): closed by my reversal above, which made all 3 tests fail.

Class checks: CLI from the scratch copy, with its own HOME and TODO_MD_HOME.
- `projects ls` with `projects: *x`, where the anchor holds a map, a null or a sequence: all three exit 1 with "projects must be a map, not an alias" and leave the file unchanged.
- `rm p` where `p` anchors `&b` and `q: *b`: exit 1, "the edit would leave alias *b unresolved", file unchanged.
- An anchor name with a dot, used by a top-level key outside projects (`other: *b.c`): "…alias *b.c unresolved", unchanged.
- A nested anchor inside an entry (`tags: &t [a]`, used by q): "…alias *t unresolved", unchanged.
- `rm q`, removing the alias rather than the anchor, succeeds. `rename p r` keeps the anchor and succeeds.
- Why the comment's premise holds: `read` runs `doc.toJS` on the whole document, so an unresolved alias cannot survive `read`. Any such failure in `write` therefore comes from the edit. An edit that adds an alias is not possible, because set and delete only take plain values.
- Not tried: alias-bomb output from `write`. No edit can create aliases.

Stale text: rg -n "must be a map|Unresolved alias|resolving alias" across the whole repo, hidden files included.
- The old README phrase "(a resolving alias is fine)" is gone from src/.
- docs/superpowers/plans/2026-09-13-hub-foundation.md:805 and docs/dogfooding/runs/67…:45 still have the old text. Both are dated history.
- The "Unresolved alias" literals left in test/markdown, test/fs and test/cli belong to frontmatter or to read-side registry errors, and are still correct.

Gate and lint: check.command is `bun run check`, and check#1 passed at ce02317 (1596 tests). Its output.log reads "Found 0 warnings and 0 errors", so 0 warnings. I did not read the base's lint count separately. A local `bun run lint` failed in oxlint's loadPlugin while my scratch worktree existed, so I relied on the check log.

Cost: one isAlias check and one regex over an error message. Nothing to measure at scale.

Commit ce02317 is a single fix(hub) commit and stays within the task.

Minor and not blocking: `rename` rewrites `{source: memory}` as `{ source: memory }`. This predates the change, because `doc.toString()` reformats flow maps, and it is outside this task.

Branch: nzila/01M5GZE6PN6VFAAV539B369V8D

nzila run 01M5GZE6PN6VFAAV539B369V8D
