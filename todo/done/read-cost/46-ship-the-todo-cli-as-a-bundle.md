---
title: Ship the todo CLI as a bundle
tags: [perf]
group: Read cost
completed_at: 2026-10-21T16:30:14Z
outcome: completed
---
Most of every `todo` command is loading code, not reading lists. On
2026-10-21 (main 4b48168, bun 1.4.3) `bun -e 0` starts in 16 ms, but
`todo --help` takes 159 ms and importing `src/cli/index.ts` alone 125 ms;
a CPU profile of `todo --project <other> ls` spends ~40 ms in `node:path`
module resolution with no `src/` caller. A `bun build src/cli/bin.ts
--target=bun --minify` bundle prints the same output for `ls`, `next --json`,
`--project <other> ls` and `ls --all`, and halves every command (best of 5):

| command                 | source | bundle |
| ----------------------- | ------ | ------ |
| `todo --help`           | 159 ms | 72 ms  |
| `todo ls` (this list)   | 195 ms | 100 ms |
| `todo --project <other> ls` | 157 ms | 73 ms  |
| `todo ls --all`         | 156 ms | 73 ms  |

Add a `build:cli` script that bundles `src/cli/bin.ts` to `dist/`, point
`bin.todo` at it and build it on install (`prepare`), so a git install
gets it; `bun src/cli/bin.ts` stays the way to run from source. The bundle
currently copies a 1.58 MB `resolver.darwin-arm64-*.node` asset from the web
dependencies: mark that package external so the bundle stays portable and
`todo web` still loads the server lazily. `--bytecode` was tried and does not
build (ESM needs `--compile`, and `--compile --bytecode` fails), so leave it out.

Done when: `todo --help` from the installed bin runs in under 80 ms warm,
a test pins that the bundled and source CLIs print the same output for
`ls`, `next --json` and `ls --all`, and `bun run check` passes.

## Comments

### @agent at 2026-10-21 16:30:14 +00:00

Done: Fixed review R1 in commit 81df7d3 (fix(cli): share the bundled runtime with lazy web server). Worktree clean.

R1 was verified, not pushed back on: test-first registration of the filesystem fixture caused all three requested bundled web variants to fail at the missing startup URL (default, explicit project, unregistered directory). The original four metadata/parity tests passed. No failure was called pre-existing.

Implementation / deliberate plan change:
- scripts/build-cli.ts now bundles the server into a lazy split chunk, sharing the CLI's bundled Effect runtime rather than passing bundled source schemas into an installed-runtime server. Only src/web/app/assets.ts is externalized by the exact resolved file path; oxc-resolver remains external. Existing canonical-path handling is preserved.
- The plan's single-file output / external-server design was unsafe at the schema boundary. Generated output now comprises bin.js and sibling JS chunks, which must stay together. No runtime source, schema validation, source definitions, dependencies, package metadata, or CLI operation semantics changed. Two local docs describe this change.
- bundle.test.ts registers a filesystem project and verifies HTTP 200 startup for default registered selection, explicit --project, plain web from an unregistered cwd with another registered entry present, and explicit unregistered --dir. Existing ls / next --json / ls --all exact parity checks remain.
- Added a relocation test proving help does not load external source assets. Negative control with splitting:false produced exactly this new failure (Cannot find module .../src/web/app/assets.ts); restoring splitting:true passed. Initial R1 red run: 4 pass, 1 skip, 3 fail. All subsequent real verification passed.

Verification (logs under this attempt directory, TMPDIR=<attempt>/tmp):
- bun test test/cli/bundle.test.ts test/cli/bin.test.ts test/cli/help.test.ts test/cli/web.test.ts test/cli/query.test.ts test/cli/projects.test.ts test/web/server.test.ts: 41 pass, 1 opt-in skip, 0 fail. Initial command also named nonexistent test/web/assets.test.ts; file discovery selected the real asset tests below instead.
- bun test test/web/asset-mounts.test.ts test/web/harness.test.ts: 4 pass, 0 fail.
- bun run lint: exit 0, formatting clean across 261 files; bun run typecheck: exit 0. Separate commands, both completed.
- TODO_CLI_BENCHMARK=1 bun test test/cli/bundle.test.ts: 10 pass, 0 fail; warm installed help best-of-five 65.32 ms (<80 ms).
- Same bundle tests with TMPDIR pointing through an attempt-local symlink: 9 pass, 1 opt-in skip, 0 fail.
- bun scripts/build-cli.ts <attempt>/artifact-dist: exit 0; five JS files only, no native payload. bin.js 137237 bytes executable; remaining chunks 582932, 266028, 2226, 890 bytes.
- Generated import inspection via bun -e over readdirSync/readFileSync: bin.js dynamically imports ./chunk-yfbbe37t.js; only that lazy chunk imports source assets. Relocated-help test independently proves this boundary is lazy.
- git diff --check clean; committed only scripts/build-cli.ts, test/cli/bundle.test.ts, src/cli/README.md, docs/architecture/tooling.md.

Impact search run:
rg -n 'src/cli/bin.ts|bin.todo|build:cli|prepare|--all|next.*--json|49152|assets\.ts|server\.ts' src/cli test/cli src/web test/web scripts/build-cli.ts package.json docs/architecture/tooling.md
Selected CLI bundle/bin/help/web/query/projects and web server/asset-mounts/harness checks. Shared harness rules themselves were not changed.

Load-bearing external-code claims were checked with:
rg -n 'import\("../../web/server.ts"\)|createAssets|import.meta.dir|import.meta.resolve' src/cli/commands/web.ts src/web/app/assets.ts
Observed the lazy server import at web.ts:45 and createAssets default resolve(import.meta.dir, "..") plus remix/ui module discovery at assets.ts:112-114. This is why only asset discovery must stay module-relative/external. Source server and fs config reads confirmed the schema boundary described in R1; the failing registered-project tests demonstrated its user-visible effect.

No whole gate, installs, shared-install edits, foreign checkout writes, or main checkout writes. Check stage owns the full gate on this new commit. Review can focus on the new split-runtime boundary and four registered-registry startup cases.

Review: approved (4/5)
Review visit 2: read the complete diff 56c54aa..81df7d3 (5 files: package.json, scripts/build-cli.ts, src/cli/README.md, docs/architecture/tooling.md, test/cli/bundle.test.ts). Approved.

Earlier findings:
- R1 (bundled web fails with a registered filesystem project): FIXED in 81df7d3. Instead of an external server, the server is now a lazy split chunk. It shares the CLI's bundled Effect runtime, so no schema crosses runtimes. Only src/web/app/assets.ts (plus oxc-resolver) stays external. Evidence: generated-import inspection of a fresh `bun scripts/build-cli.ts <attempt>/probe/dist`. bin.js statically imports only ./chunk-dgpskt75.js (the shared runtime), bun:sqlite, fs and os. It loads `import("./chunk-0bq38rhs.js")` lazily, and only that chunk imports `.../src/web/app/assets.ts`. assets.ts imports only node:*, remix/assets and remix/router (no effect), so no schema boundary remains. The `basePath:"/assets"` literal is absent from every chunk (grep -l exit 1): assets.ts is not duplicated in the bundle, so the `assetsContext` key has a single identity. It is imported via both `./assets.ts` (router.ts:12) and `../assets.ts` (controller.tsx:9), and the resolve-equality filter handles both spellings.
- New in this round: none.

Task "Done when" walk:
- Warm installed-bin help under 80 ms: pinned by `warm installed help is under 80 ms, best of five` (test/cli/bundle.test.ts, opt-in TODO_CLI_BENCHMARK=1). Measured: `TMPDIR=<attempt>/tmp TODO_CLI_BENCHMARK=1 bun test test/cli/bundle.test.ts` gave 10 pass, 0 fail, "warm installed help best-of-5: 59.11 ms". It runs the bin symlink, not a Bun import.
- Bundle/source parity for ls, next --json, ls --all: pinned by `bundle matches source for ls|next --json|ls --all`. Each compares code, stdout and stderr. It fails on any byte difference, and also if source output is non-empty on stderr or lacks "Ready task". Fixture totals: 2 tasks added and task 2 done, so ls shows 1 open and ls --all also shows the done one. Review#1 reversed this test (substituting next --json output) and saw it fail.
- `bun run check`: check.command is `bun run check`, the same as Done-when. check#3 passed on check.commit 81df7d3 (1428 tests across 105 files). Recorded gate output: "Found 0 warnings and 0 errors". Reviewer oxlint run alone: exit 0, no warnings. Base had 0 too (review#1). Not rerun here, as instructed.
- Task constraints: build:cli, bin.todo ./dist/bin.js and prepare are pinned in `installs the bundle and builds it in prepare`. Review#1 reversed each literal and saw it fail. Bundle is portable: every output file is .js and there is no .node payload (5 files, bin.js 137 KB mode 0755). Web loads lazily: `help does not load the external web assets module` relocates dist and help still matches source. do#3's splitting:false control failed it. No --bytecode/--compile is used. `bun src/cli/bin.ts` is unchanged as the source path.
- R1 regressions: pinned by 4 tests `bundle serves web with a registered project present: {default registered list, explicit registered project, unregistered cwd, explicit unregistered dir}`. Each needs a printed URL and HTTP 200 with a non-empty body. Scratch reversal: with `plugins: []` (assets bundled into dist), all 4 failed and 5 passed; the scratch worktree was removed.
- Beyond the tests, I probed the real web app with a registered project. The bundle's /p/probe returned 200 and 49531 bytes, including the "Ready task" row. All 62 /assets/* src/href URLs on the page returned 200: the app's own entries, remix component runtime, route-pattern and @lemol/ui. So module-relative asset mounts work from the bundle.
- Not exercised: Git, Jira and sqlite web variants; Windows paths (macOS host).

Other walks:
- What-to-build: the task has no numbered section. The plan's single item is done across the five paths. The plan's single-file/external-server design was deliberately changed, with the reason given in do#3 (the schema boundary is unsafe). The docs describe this.
- Comments: read todo/read-cost/46-ship-the-todo-cli-as-a-bundle.md and the brief. There is no Pre-start task comments section and no Comments section: 0 comments, authors: none.
- Implementer gaps:
  - Full gate not rerun in do: done by check#3 on 81df7d3.
  - Real git install/prepare not executed: pushed back. Installs are prohibited here. The prepare/bin metadata and the generated executable via the symlinked bin are integration-tested. Bun's prepare-on-git-install behaviour is unverified on this machine.
- Commits:
  - d44af7a: the task rule.
  - ad2fc8c: fixes the check#1 symlinked-outdir failure; canonicalization is kept in 81df7d3.
  - 81df7d3: answers R1.
  - None is outside its rule.
- Stale values: searched `dist/bin.js|single.file|external server|server\.ts stays|No build step` across the repo, hidden files included and node_modules/.worktrees excluded. Live hits are package.json:7, scripts/build-cli.ts:2, test/cli/bundle.test.ts:56, docs/architecture/tooling.md:73 and src/cli/README.md:10, all consistent with the bin.js-plus-chunks output. There is no remaining "No build step" and no external-server wording.
- Test placement: no new src module. The build script is tested in test/cli, matching the repo's mirrored test tree.

Observation outside this diff (no src file changed): source `bun src/cli/bin.ts web` on the same fixture returned 200 with only 42 bytes (`<!DOCTYPE html><!-- rmx:flush fragment -->`). The bundle rendered the full page. This is worth a separate look but is not caused by this branch.

No branch edits, installs or shared-install changes. Probe and scratch dirs were removed.

