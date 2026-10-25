# Packaging, testing and tooling

## Why one package

todo.md is consumed the way the other lemol repositories are: as a git
dependency pinned to a tag, or, by a consumer that has it checked out as a
workspace member, as `workspace:*`:

```jsonc
// a consumer anywhere
"@lemol/todo-md": "git+ssh://git@github.com/lemol/todo.md.git#todo-md@0.2.0"
// a consumer in the same Bun workspace as this checkout
"@lemol/todo-md": "workspace:*"
```

Git dependencies install only the repository's root package. We checked the
alternative: an umbrella root package that re-exports inner workspace
packages fails at runtime, because the inner packages' imports of each other
(`@lemol/todo-md-spec`) and their own dependencies are never installed. One
package with subpath exports works, and the boundaries test keeps the modules
honest the way separate manifests would.

`effect` is a **peer dependency pinned to the exact version the other lemol
repositories use**. Two copies of `effect` in one process break schema and
error class identity and Effect's runtime internals, so consumers, framework
and todo.md must share a single copy.

The web UI lives in `src/web` and ships in the published package, so `remix` (exact) and the Markdown renderer packages are runtime dependencies.

## Testing

- **Runner:** `bun test` everywhere. `@effect/vitest` is not used because it
  depends on vitest internals.
- **Effect helper:** `@lemol/todo-md/spec/testing` exports
  `effectTest(name, effect, layer?)`, which runs an Effect in a `bun:test`
  test with a scope and Effect's `TestClock`/`TestConsole` (`effect/testing`).
  This entry point is never imported by runtime code.
- **Boundaries:** `test/boundaries.test.ts` enforces the module graph.
- **Layout:** tests live in `test/<module>/`, mirroring `src/`.
- **No network, no real home.** Tests use temporary directories; remote
  sources are tested against local bare repositories and fake HTTP layers.

| Module     | Strategy                                                                   |
| ---------- | -------------------------------------------------------------------------- |
| `spec`     | `MemoryTodoStore` passes the conformance suite.                            |
| `markdown` | Golden fixtures for parsing, every edit and normalization; minimal diffs asserted. |
| `core`     | Unit tests against `MemoryTodoStore`.                                      |
| `fs`       | Conformance suite against temporary directories, plus crash/lock/hand-edit scenarios. |
| `cli`      | End-to-end tests: run commands with `--json` against temporary directories. |
| `web` | Router tests over `MemoryTodoStore`, an end-to-end test over `FsTodoStore`, security tests. |
| `hub` *(planned)* | Tests over `memorySource` and temporary homes.                      |
| `git` *(planned)* | Conformance over a clone of a local bare repository, plus push/rebase/offline scenarios. |
| `jira` *(planned)* | Conformance with `seed` against a fake Jira `HttpClient` layer; golden ADF → Markdown. |

## Tooling

- **Bun 1.4** with a single `package.json` at the repository root.
- **Effect 4.** `effect` is a pinned peer dependency (plus the same
  version as a dev dependency), and `@effect/platform-bun` uses the same
  version. Upgrade them together with the other lemol repositories.
- **`@effect/platform-node-shared` is pinned too**, as a dependency and in
  `overrides`. `@effect/platform-bun` asks for it with a caret range, which
  would otherwise resolve to a newer release than our `effect`. Effect
  releases every package at one version, so all of them must match.
- **TypeScript**, strict, with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`.
- **Biome** for linting and formatting.
- **One gate for CI and downstream checks:** `bun run check` runs lint,
  typecheck and tests.
- **One build step.** Subpath exports point at TypeScript sources, which Bun
  runs directly, the same as `@lemol/framework`; the installed executable is
  bundled instead. `bun run build:cli` bundles `src/cli/bin.ts` into
  `dist/bin.js` and sibling chunks (built on install via `prepare`). The web
  server is a lazy chunk sharing the CLI's Effect runtime, not an external
  module receiving bundled schemas. The CLI reaches it through
  `src/web/load.ts`, which registers the `remix/component` JSX loader first.
  Asset discovery (`src/web/app/assets.ts`) and the native resolver
  (`oxc-resolver`) stay external so module-relative
  source assets work and output stays portable. No `--bytecode` or
  `--compile`: ESM needs `--compile`, and `--compile --bytecode` does not
  build.
- **Releases** are git tags named `todo-md@<version>`.
