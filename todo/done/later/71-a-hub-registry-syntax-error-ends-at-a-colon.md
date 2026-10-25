---
title: A hub registry syntax error ends at a colon
tags: [bug, hub]
group: Later
completed_at: 2026-10-22T05:32:35Z
outcome: completed
---
Found by the controller's post-land review of todo-md:68 (landed `95e9c79`). 69 fixes the same flaw for task-file frontmatter and leaves the registry out of scope, naming 68. 68 only covered alias messages.

Evidence (scratch at `95e9c79`, own `HOME` and `TODO_MD_HOME`):

- `projects.yaml` = `projects: !!map *x\n`. `todo projects ls` exits 1 with `error: <file>: An alias node must not specify any properties at line 1, column 17:`.
- `yamlFailure` in `src/hub/registry.ts` keeps the first line of `yaml`'s message. That message continues after the colon with a code frame, so every YAML syntax error in the registry prints a dangling colon. Every `todo` command that reads the hub prints this message.

#### What to build

1. A registry YAML syntax error's message does not end at a dangling colon. Keep the position (the registry has no fence, so `yaml`'s line is the file's line). Reuse 69's approach if it has landed, so the two messages read alike.
2. Messages without a position (an unresolved alias, an alias bomb, "projects must be a map") stay as they are.

#### Tests first

- `test/hub/registry.test.ts`: `projects: [\n` and `projects: !!map *x\n` make `entries` fail with a `RegistryError` whose exact message has no trailing colon and names line and column.
- `test/cli/bin.test.ts`'s bad-registry case, if it asserts a syntax error, gets the new message.

#### Done when

No registry error message ends at a colon.

#### Out of scope

Frontmatter (69). The layout of edited entries (70).

## Comments

### @agent at 2026-10-22 05:32:35 +00:00

Done: Implemented and committed as 8aa248c (fix(hub): remove dangling colon from registry syntax errors).

Registry YAML diagnostics now drop only the colon introducing the omitted code frame, retaining yaml's original file line and column. This produces the same position wording as landed task 69 without changing frontmatter or adding a fence offset. Non-position diagnostics are untouched. Added exact RegistryError assertions for `projects: [\n` (line 2, column 1) and `projects: !!map *x\n` (line 1, column 17). Existing CLI bad-registry case asserts an unresolved alias, not syntax, so no update was needed.

Test-first evidence: `bun test test/hub/registry.test.ts` initially had 21 pass / 2 fail; both failures were exactly the unwanted trailing colon. After the fix, `bun test test/hub/registry.test.ts test/hub/Hub.test.ts test/hub/resolve.test.ts test/cli/bin.test.ts` passed all 71 tests, including existing exact unresolved-alias and alias-bomb messages. Repeated after formatting: 71 pass / 0 fail.

Static checks: `bun run typecheck` passed. Initial `bun run lint` failed only on new test formatting; formatted that file with `bun x --no-install oxfmt test/hub/registry.test.ts`, then `bun run lint` passed. `git diff --check` passed; checkout clean after commit. Full gate deliberately not run, per brief.

Focused-test discovery searches:
- `rg -n 'yamlFailure|linePos|bad.registry|projects: \[|alias node|projects must be a map' src test`
- `rg -n 'Flow sequence|An alias node|at line [0-9]+, column|projects must be a map|Unresolved alias|Excessive alias' src test`
- `rg -n -F 'projects: [\n' src test`
- `rg -n 'RegistryError|projects.yaml' test/hub/Hub.test.ts test/hub/resolve.test.ts test/cli`
These identified the registry consumers and syntax fixture users exercised above. Frontmatter-only matches remain out of scope. No shared installs or other checkouts modified.

Review: approved (5/5)
Approved. Diff 4907ec1..8aa248c: src/hub/registry.ts (yamlFailure) and test/hub/registry.test.ts only. One commit, 8aa248c "fix(hub): remove dangling colon from registry syntax errors", a do-stage code commit within the task's scope, with the required co-author line.

What to build:
1. Done. In `yamlFailure`, src/hub/registry.ts:105-114: the first line of yaml's message is kept, and `head.replace(/( at line \d+, column \d+):$/, "$1")` drops only the colon after a position. No offset is applied, so yaml's line is the file's line. Same final shape as 69's frontmatter message (`${head} at line N, column M`, src/markdown/frontmatter.ts:52).
2. Done. Messages without a position don't match the anchored regex. They are still pinned by the existing exact tests: registry.test.ts:255-257 (Unresolved alias, Excessive alias count) and :180-181 (not a map).

Tests / Done when:
- `projects: [\n` and `projects: !!map *x\n`: pinned by test/hub/registry.test.ts "syntax errors keep their file position without a dangling colon: <text>". Each asserts an exact message that names line and column and has no trailing colon. The expected literal is yaml's output, not something the request supplied. To check the tests can fail, I removed the replace in a scratch worktree. Both tests failed with the actual message ending in "column 1:" and "column 17:" (21 pass / 2 fail). Scratch worktree removed.
- The old `projects: [\n` "unparsable YAML" case moved into the new exact-message loop, so no coverage was lost.
- test/cli/bin.test.ts "a bad registry is one error line, and --dir does not need it" asserts an Unresolved alias message (line 86), not a syntax error, so it needed no update. Agreed.
- Done when, "no registry error message ends at a colon". I checked the class with a probe that runs parseDocument plus the new replace over 17 inputs. Syntax errors tried: flow seq, alias with properties, duplicate keys, an unclosed `{`, a compact nested map, tab indentation, an unclosed quote, a multi-line implicit key, `? [a`, CRLF input, block header `|x`, a key over 1024 chars, and a flow pair key. All of them came out "ok" with no trailing colon. Inputs that parse cleanly (a duplicate %YAML directive, a duplicate anchor, !!binary, a control character) raise no error. Not tried: non-Error causes, because String(cause) has no code frame.

Comments: the task file todo/later/71-*.md has no Comments section (its headings are What to build, Tests first, Done when, Out of scope), and the brief has no pre-start comments. 0 comments, no authors.
Implementer's stated gaps: the only one is that the full gate was not run, as the brief directs. check#1 then ran `bun run check` (check.command) on 8aa248c and passed: 1602 tests across 109 files.

Ran: `bun test test/hub/registry.test.ts test/cli/bin.test.ts` gave 26 pass / 0 fail. `bun run lint`: "All matched files use the correct format", 0 warnings, same as the base. Other copies: `rg -n -F 'split(/\r\n|\r|\n/)[0]' src test` finds only src/hub/registry.ts:108. Frontmatter (69) has its own handling and is out of scope. The diff adds no config, command or migration, and no doc mentions the message format. The cost is one regex on one line per error.

