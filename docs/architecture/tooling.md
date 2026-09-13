# Packaging, testing and tooling

## Why one package

todo.md is consumed the way the other lemol repositories are: as a git
dependency pinned to a tag, which a composition root such as
`lemol-workspace` overrides with a local checkout:

```jsonc
// consumer
"@lemol/todo-md": "git+ssh://git@github.com/lemol/todo.md.git#todo-md@0.1.0"
// composition root
"overrides": { "@lemol/todo-md": "file:./repos/todo-md" }
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

Apps under `apps/*` (the web app) are private workspace members. Git
consumers of `@lemol/todo-md` never install them, so the published package
does not depend on Remix.

## Testing

- **Runner:** `bun test` everywhere. `@effect/vitest` is not used because it
  depends on vitest internals.
- **Effect helper:** `@lemol/todo-md/spec/testing` exports
  `effectTest(name, effect, layer?)`, which runs an Effect in a `bun:test`
  test with a scope and Effect's `TestClock`/`TestConsole` (`effect/testing`).
  This entry point is never imported by runtime code.
- **Boundaries:** `test/boundaries.test.ts` enforces the module graph.
- **Layout:** tests live in `test/<module>/`, mirroring `src/`; the web app's
  in `apps/web/test/`.
- **No network, no real home.** Tests use temporary directories; remote
  sources are tested against local bare repositories and fake HTTP layers.

| Module     | Strategy                                                                   |
| ---------- | -------------------------------------------------------------------------- |
| `spec`     | `MemoryTodoStore` passes the conformance suite.                            |
| `markdown` | Golden fixtures for parsing, every edit and normalization; minimal diffs asserted. |
| `core`     | Unit tests against `MemoryTodoStore`.                                      |
| `fs`       | Conformance suite against temporary directories, plus crash/lock/hand-edit scenarios. |
| `cli`      | End-to-end tests: run commands with `--json` against temporary directories. |
| `apps/web` | Router tests over `MemoryTodoStore`, an end-to-end test over `FsTodoStore`, security tests. |
| `hub` *(planned)* | Tests over `memorySource` and temporary homes.                      |
| `git` *(planned)* | Conformance over a clone of a local bare repository, plus push/rebase/offline scenarios. |
| `jira` *(planned)* | Conformance with `seed` against a fake Jira `HttpClient` layer; golden ADF → Markdown. |

## Tooling

- **Bun 1.4** with a single `package.json` at the repository root.
- **Effect 4 RC.** `effect` is a pinned peer dependency (plus the same
  version as a dev dependency), and `@effect/platform-bun` uses the same
  version. Upgrade them together with the other lemol repositories.
- **`@effect/platform-node-shared` is pinned too**, as a dependency and in
  `overrides`. `@effect/platform-bun` asks for it with a range
  (`^4.0.0-rc.108`) that otherwise resolves to a newer release candidate,
  which imports modules missing from our `effect`.
- **TypeScript**, strict, with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`.
- **Biome** for linting and formatting.
- **One gate for CI and `lemol-workspace`:** `bun run check` runs lint,
  typecheck and tests.
- **No build step.** Subpath exports point at TypeScript sources, which Bun
  runs directly, the same as `@lemol/framework`.
- **Releases** are git tags named `todo-md@<version>`. A standalone binary via
  `bun build --compile` can come later.
