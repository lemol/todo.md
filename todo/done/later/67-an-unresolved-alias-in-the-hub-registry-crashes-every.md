---
title: An unresolved alias in the hub registry crashes every command
tags: [bug, hub]
group: Later
completed_at: 2026-10-22T04:26:36Z
outcome: completed
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

## Comments

### @nzila at 2026-10-22 04:26:36 +00:00

Done: Fixed review finding R1 in commit 2e4a550. The check in `read` is now `doc.toJS({ mapAsMap: true })`, so a registry with a collection key no longer prints Node's "Keys with collection values will be stringified" warning. Unresolved aliases and alias bombs still throw.

- **Test:** a new test, "a registry with a collection key reads without a process warning", is in test/hub/registry.test.ts. The registry is `projects:\n  ? [a, b]\n  : {source: fs}\n`. The test asserts the entry is listed and that `process.emitWarning` is never called. It fails with the old `doc.toJS()` and passes with the fix.
- **Checks:** `bun test test/hub test/cli/bin.test.ts` gave 148 pass, 0 fail. `bun run lint` and `bun run typecheck` were run separately and both pass.
- **Not run:** `bun run check` or the whole suite, which the check stage owns.
- **Pushback:** none. R1 held.

Review: approved (5/5)
Review of 2e4a550 against f225a22 (full diff from base, not only since review#1). Files: src/hub/registry.ts, src/hub/README.md, test/hub/registry.test.ts, test/cli/bin.test.ts. R1 from review#1 is fixed. No new findings. Approve.

Diff read: `git diff --stat f225a22..HEAD` = 4 files, 226 insertions, 43 deletions. `git log` = 1d1d7da + 2e4a550. Worktree clean (`git status --porcelain` empty).

R1 fixed:
- Where was src/hub/registry.ts:127 `doc.toJS()` after comment "`toJS` throws what `parseDocument` leaves unreported".
- Now src/hub/registry.ts:127 `doc.toJS({ mapAsMap: true })` (Read lines 125-127). Probe `bun -e` with parseDocument: `mapAsMap` returns with no warning (`mapAsMap warnings: []`), plain toJS warns `Keys with collection values will be stringified ... "[ a, b ]"`, alias still throws `Unresolved alias ...: a`, bomb still throws `Excessive alias count ...`, resolving alias still reads (no throw).
- CLI probe at HEAD with `projects:\n  ? [a, b]\n  : {source: fs}`: `todo projects ls` exit 0 with entry listed as broken (invalid project name), stderr empty; `todo --dir <list> list` exit 0 stderr empty. No `(node:…) Warning`.
- New test test/hub/registry.test.ts:206-230 `collection keys > a registry with a collection key reads without a process warning` asserts `toHaveLength(1)` and `warnings` `toEqual([])` via mocked `process.emitWarning` with `Effect.ensuring` restore. Reversal: in scratch worktree with registry.ts from 1d1d7da (`doc.toJS()`), `bun test test/hub/registry.test.ts -t "collection key"` fails (1 fail, warning array has the Keys-with-collection message, expected vs received diff). Passes at HEAD (`bun test test/hub/registry.test.ts test/cli/bin.test.ts` 23 pass, 0 fail; `bun test test/hub` 145 pass).

Task required tests (Tests + Done when):
- `projects:\n  p: *a` → entries fails RegistryError naming projects.yaml + Unresolved alias. Pinned test/hub/registry.test.ts:234-250 `entries fail with a RegistryError: projects:` exact `toBe(`${root}/.todo-md/projects.yaml: Unresolved alias ...: a`)` + `toBeInstanceOf(RegistryError)`. Would have to see defect throw or different message to fail; single-expect over literal is not present (asserts over registry read, not request-supplied value). Reversed on base scratch (registry.ts from f225a22): `bun test -t "entries fail with a RegistryError"` 0 pass 3 fail with defect stack through Alias.js/toJS/map (not RegistryError). Also CLI reversal on base: `bun ./src/cli/bin.ts projects ls` exits 1 with stdout `ERROR (#2): ReferenceError: Unresolved alias ...` + stack at registry.ts:151 `at map`, stderr empty — vs HEAD test expectation stdout "" stderr one line.
- Alias bomb. Pinned same file second param with exact `Excessive alias count indicates a resource exhaustion attack`. Fixture test/hub/registry.test.ts:197-204 `aliasBomb` = 10 per level x5 levels = 10^5 expansions, exceeds yaml default maxAliasCount 100. Probe confirms `toJS({mapAsMap:true})` still throws that first line. Fails on base (defect, same 3-fail run).
- Resolving alias reused by two projects still reads. Pinned test/hub/registry.test.ts:275-293 `resolving aliases reused by two projects still read` (`base: &b {source:fs,path:/x}`, p/q). Passes on base too (keep-working, would fail if whole-document check rejected all aliases). Verified no throw in probe.
- CLI `todo projects ls` bad registry exits 1 one error line no stack. Pinned test/cli/bin.test.ts:56-94 `a bad registry is one error line, and --dir does not need it` uses `toEqual({code:1,stdout:"",stderr:`error: ${file}: Unresolved alias ...: a\n`})` so stack/extra line fails; plus `--dir` list code 0 stdout contains First stderr "". Verified at HEAD via direct CLI: bad alias `projects ls` code 1 stdout 0 bytes stderr one line, `--dir list` code 0 stderr 0 bytes. Property Done-when "No registry text makes todo die with uncaught exception": probed 15 inputs via `bun -e` spawnSync (unresolved, unresolved-merge `<<: *a`, resolved-merge, custom-tag `!foo`, `!!binary "@@@"`, `path:3`, `!!timestamp nope`, unknown source, `!!int x`, `%YAML 9.9`, two docs, selfref `&x [*x]`, collection-key, empty, `projects:` null). Each: `projects ls` either code 1 one-line `error: <file>: ...` (first line only) or code 0 listing with broken entry; `--dir list` code 0 stderr 0 in all; no `\n    at ` stack. Timestamp/two-docs stderr are single line + trailing newline (2 split lines). Deliberately did not try very large files beyond timing or non-UTF8 bytes: timing covers scale, non-UTF8 is FileSystem layer out of scope.

What to build:
1. Done src/hub/registry.ts:104-109 `yamlFailure` splits on `/\r\n|\r|\n/` first line, :117-153 `read` inside one `Effect.try` (parseDocument, doc.errors throw, whole-document toJS mapAsMap, shape checks `expected a map`/`projects must be a map`, per-entry `pair.value.toJS(doc)` at :146). Covers entries (:175), update (:177-203 via `read`), Hub.registered/Hub add check, resolve fallback. `write` :162-172 wraps `doc.toString()` same way. `rg -n "toJS\(|parseDocument" src` outside src/markdown finds only registry.ts:120,:127,:146; frontmatter.ts:45 is out of scope (tasks 65/66). Verified per-entry stays inside try.
2. Done with choice stated: `--dir` does not need registry. src/hub/resolve.ts:89-90 comment + `hub.registered.pipe(Effect.orElseSucceed(() => []))`, README lines 97-98 same. Verified by CLI test and probes above. No filing needed; change is typed RegistryError suffices.

Comments: Read todo/later/67-an-unresolved-alias-in-the-hub-registry-crashes-every.md (27 lines, `rg -n -i comment` no match, `rg -n "pre-start|Comments"` no match) and brief (no pre-start section). That is 0 comments, no authors. So none to walk; nothing missing.

Implementer's gaps:
- do#2 "Not run bun run check or whole suite, check stage owns" — done: check#2 ran brief's `check.command` `bun run check` on 2e4a550 passed 1581 tests across 107 files. check#1 ran it on 1d1d7da passed 1580 tests. Delta +1 = new collection-key test. Gap closed.
- do#1 same gap — same cover.
- Cost claim re-derived: `bun -e` 2000 entries 20 runs each: parseDocument alone avg 28.2ms, parse+toJS avg 25.7ms (noise, extra conversion is noise). Prior report 33.9 vs 31.4 same conclusion. Command and output logged.
- README matches code (src/hub/README.md:72-76 alias/bomb/resolving-first-line/write-refusal), no new module, tests in existing mirrors.

Commits vs rules (AGENTS.md): 1d1d7da + 2e4a550 both obey module graph (`bun test test/boundaries.test.ts` 13 pass), minimal diffs (splice, no re-serialize), blank-line/style (`bun run lint` oxfmt+oxlint clean, `bun run typecheck` clean), conformance untouched, `effectTest` used, isolation via Disk/scratch HOME/TODO_MD_HOME, no core dep, no new CLI flags. No finding; no commit outside its rule.

Check command: brief's `check.command` is `bun run check` (not Done-when). check#2 ran it and passed. I ran touched checks only: `bun test test/hub/registry.test.ts test/cli/bin.test.ts` 23 pass, `bun test test/hub` 145 pass, `bun test test/boundaries.test.ts` 13 pass, `bun run lint` 0 warnings/errors, `bun run typecheck` clean. Did not run whole gate per instructions.

Other checks:
- Fixture numbers: collection-key expects 1 entry — fixture has one `? [a,b] : {source:fs}` so 1 correct; bomb 10^5 verified; `toHaveLength(1)`/`toEqual([])` exact.
- Constraint out of scope (frontmatter 65/66) left out: `rg` shows src/markdown untouched.
- Reads-more-than-once: single `readFileString`, in-memory toJS twice, update under `makeLock` re-reads fresh then atomic tmp+rename; no cross-crash second read.
- Predicate class: yaml alias/collection/merge/tag checked above; nested collection-key inside entry value still warns (6 warnings) but base scratch also warns 6 times for same input (`projects:\n  p:\n    source:fs\n    ? [a,b]\n    : c`), so pre-existing not regression; R1 scope was top-level map keys which base never converted. Not raised.
- External events/logs: no new event; `hub.changes` watch untouched. No real-record needed beyond CLI probes above.
- No new config/field/command; no migration.
- Linter: `bun run lint` = `All matched files use correct format` + oxlint silent = 0 warnings 0 errors; baseline from gate log on 1d1d7da also 0, HEAD 0, no increase, no file attribution needed.
- Quantities re-derived: bomb 10^5, test totals 145+3=148 matches do#2's 148, check 1580→1581 matches +1 test, cost noise. Value change `doc.toJS()`→`doc.toJS({mapAsMap:true})` search `rg -n mapAsMap` finds only registry.ts:127, no stale copy; search `rg -n "as does an alias"` finds README:73 proving search works.
- Verification observed not predicted: all CLI/yaml probes run, outputs quoted above.

Earlier findings: R1 fixed (see above). No new open findings.

Citations: src/hub/registry.ts:127, :146, :105-109, :117-160, :162-172; test/hub/registry.test.ts:197-204, :206-230, :233-250, :275-293, :295-312; test/cli/bin.test.ts:56-94; src/hub/resolve.ts:89-90; src/hub/README.md:72-76. Commands: `git diff --stat f225a22..HEAD`, `rg -n "toJS\(|parseDocument" src`, `rg -n "Unresolved alias" .`, `rg -n mapAsMap .`, `bun test ...`, `bun run lint`, `bun run typecheck`, `bun test test/boundaries.test.ts`, yaml/CLI/cost `bun -e` probes.

Branch: nzila/01M5GWF9M08NKXCFY84GVQ70KY

nzila run 01M5GWF9M08NKXCFY84GVQ70KY
