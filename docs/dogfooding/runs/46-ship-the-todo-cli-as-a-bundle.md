# 46 Ship the todo CLI as a bundle

Run `01M5FHX9RBYAMV5NPB44VCEA0V`, loop `01M5FHVVJ6H539ZGYMN78TTRXJ` (width
1). Landed `a1df35a`. The code is in `86f8909`, `298bf4a` and `483d4af`
(on the branch: `d44af7a`, `ad2fc8c`, `81df7d3`).

## Attempts

- triage#1 rated it moderate/medium infrastructure and switched to planned.
- plan#1 bundled the CLI and kept the web server external. That design
  passed the bundle's schemas into the installed Effect runtime.
- do#1 implemented the plan. check#1 failed twice:
  - the bundle's web test, because a symlinked `/tmp` outdir miscounted the
    `..` climb (fixed in do#2 by canonicalizing paths);
  - the git conformance test `listDone returns the most recently completed
    task first`, a sandbox false positive. Another process wrote
    `~/.todo-md/cache/*.json` during the gate, and that test has no
    `cacheDir`. Filed as 48.
- review#1 (changes, R1): with any registered project, bundled `todo web`
  died with `e.startsWith is not a function`. A bundled `FsConfig` filter
  ran under the installed `SchemaAST`.
- do#3 bundled the server as a lazy split chunk on the CLI's runtime and
  kept only `src/web/app/assets.ts` external. It pinned four
  registered-registry startup cases and a lazy-boundary relocation test.
- review#2 approved. It noted that source `todo web` serves 42 bytes.

## Controller review (intensive)

- The task's Done when:
  - warm help: `warm installed help is under 80 ms, best of five`,
    opt-in, 59 ms in review#2;
  - parity: `bundle matches source for ls|next --json|ls --all`;
  - `bun run check`: check#3 on `81df7d3`.
- On main `a1df35a`, `bun run check` failed once in
  `test/hub/fs.test.ts` › `skips what a caller's ignore rejects…` (load
  average ~8) and then passed: 1300 pass, 0 fail. Filed as 51.
- Reproduced review#2's observation on a scratch fixture. Source
  `todo web` run from outside the repository gives 42 bytes. From the
  repository root, or from the bundle, it gives 49461 bytes. Filed as 49.
- Neither review asked how an installed bin gets a current `dist/`:
  - main has no `dist/`;
  - the workspace's store copy of todo-md has no `dist/` or `scripts/`;
  - existing `.bin/todo` links still point at `src/cli/bin.ts` until the
    next install;
  - `build:cli` never empties its outdir.

  Filed as 50, which needs the person's choice.
- Fixed nothing on main. This repository has no `test/timings.json`.
