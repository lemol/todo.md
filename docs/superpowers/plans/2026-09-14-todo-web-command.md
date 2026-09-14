# `todo web` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the web app into the published package as `src/web` + `test/web` and add a `todo web` command with checkout parity to `bun run web`.

**Architecture:** `git mv` the whole `apps/web` tree (internal relative imports survive), rewrite only the `@lemol/todo-md/*` package imports to relative paths, repoint the boundaries checker at `src/web`, then wrap the unchanged `startServer` in a thin Effect CLI command that owns arg parsing and lifecycle via `Effect.acquireRelease` + `Effect.never`.

**Tech Stack:** Bun 1.4, TypeScript 7, Effect `4.0.0-rc.108`, `effect/unstable/cli`, Remix `3.0.0-rc.2` (exact), `bun:test`.

**Spec:** [2026-09-14-todo-web-design.md](../specs/2026-09-14-todo-web-design.md) — the plan argues from the spec; read both.

## Global Constraints

- `remix` is pinned exactly to `3.0.0-rc.2`; `effect`, `@effect/platform-bun` and `@effect/platform-node-shared` stay exactly at `4.0.0-rc.108`.
- No new package subpath export: the web UI is reached only through `todo web`. `src/web` imports siblings through relative paths, never `@lemol/todo-md/...`.
- Before writing any Effect code, read `node_modules/effect/AGENTS.md` completely and follow its links as required.
- TDD iron law: no production code without a failing test first. Moved web files keep their moved tests as coverage; the new CLI command gets new failing tests first.
- Biome style: double quotes, no semicolons, 2 spaces, width 100.
- `bun run check` (lint + typecheck + tests) is the gate for every task.
- History writes need an explicit user yes per write: ask before running any `git commit` below.

---

### Task 1: Move the web app into `src/web` and `test/web`

**Files:**
- Move: `apps/web/server.ts`, `apps/web/watch.ts`, `apps/web/app/**`, `apps/web/README.md` → `src/web/`
- Move: `apps/web/test/**` → `test/web/`
- Delete: `apps/web/package.json`, `apps/web/tsconfig.json`
- Modify: `package.json`, `tsconfig.json`, `test/boundaries.test.ts`, `bun.lock` (via `bun install`)
- Test: `bun run typecheck`, `bun test test/web/`, `bun test test/boundaries.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `src/web/server.ts` exporting `startServer` + `resolveRoot` with unchanged semantics; `src/web/app/**` addressable via `../../spec`, `../../core`, `../../fs` relative imports; `test/web/**` importing the app via `../../src/web/...`.

- [ ] **Step 1: Move the tree**

```bash
mkdir -p src/web test/web
git mv apps/web/server.ts apps/web/watch.ts apps/web/app apps/web/README.md src/web/
git mv apps/web/test/contracts.test.ts apps/web/test/events.test.ts apps/web/test/fs-e2e.test.ts apps/web/test/harness.ts apps/web/test/router.test.ts apps/web/test/routes.test.ts apps/web/test/security.test.ts apps/web/test/server.test.ts apps/web/test/ui.test.ts apps/web/test/watch.test.ts test/web/
git rm apps/web/package.json apps/web/tsconfig.json
```

Run: `git status --short`
Expected: renames under `src/web/` and `test/web/`, deletions for the two manifests, nothing else.

Then remove the leftover ignored workspace install (untracked, never committed):

```bash
git status --short --ignored apps/web
rm -rf apps/web
```

The ignored-status output must show only `!!` (ignored) entries — `apps/web/node_modules` — before removing. `git mv`/`git rm` already moved every tracked file, so deleting the directory cannot lose user work.

- [ ] **Step 2: Rewrite package imports to relative paths**

Internal relative imports survived the move. Only `@lemol/todo-md/*` imports change, grouped by depth (verify each with `grep -rn "@lemol/todo-md" src/web test/web` afterwards; expect no output):

```bash
perl -pi -e 's{"@lemol/todo-md/(core|fs|spec)"}{"../$1/index.ts"}g' src/web/server.ts
perl -pi -e 's{"@lemol/todo-md/(core|spec)"}{"../../$1/index.ts"}g' src/web/app/router.ts
perl -pi -e 's{"@lemol/todo-md/(core|spec)"}{"../../../$1/index.ts"}g' src/web/app/middleware/todo.ts src/web/app/actions/controller.tsx src/web/app/actions/forms.ts src/web/app/actions/page.ts src/web/app/ui/board.tsx src/web/app/ui/secondary.tsx src/web/app/ui/task.tsx src/web/app/actions/groups/controller.tsx
perl -pi -e 's{"@lemol/todo-md/(core|fs|spec)"}{"../../src/$1/index.ts"}g' test/web/harness.ts test/web/contracts.test.ts test/web/events.test.ts test/web/fs-e2e.test.ts test/web/security.test.ts
perl -pi -e 's{"\.\./app/}{"../../src/web/app/}g; s{"\.\./server\.ts"}{"../../src/web/server.ts"}g; s{"\.\./watch\.ts"}{"../../src/web/watch.ts"}g' test/web/*.ts
```

Concretely this yields, for example in `src/web/server.ts`:

```ts
import { TodoService } from "../core/index.ts"
import { FsTodoStore, findListRoot } from "../fs/index.ts"
import { allCapabilities } from "../spec/index.ts"
```

and in `test/web/harness.ts`:

```ts
import { TodoService } from "../../src/core/index.ts"
import { allCapabilities, MemoryTodoStore } from "../../src/spec/index.ts"
import type { AppAssets } from "../../src/web/app/assets.ts"
import { makeFakeChanges } from "../../src/web/app/middleware/changes.ts"
import { createAppRouter } from "../../src/web/app/router.ts"
```

`createAssets` needs no change: its default `resolve(import.meta.dir, "..")` now resolves to `src/web`, still the web root, and `denyFiles: ["app/**/*.test.*"]` still matches `src/web/app/**/public/refresh.test.ts`.

- [ ] **Step 3: Update the root `package.json`**

Apply these exact edits (copy the dependency lines verbatim from the deleted `apps/web/package.json`):

1. Delete the `"workspaces": ["apps/*"]` block.
2. Change `"web": "bun apps/web/server.ts"` to `"web": "bun src/web/server.ts"` (temporary entry until Task 2 replaces it with `todo web`).
3. Change `"typecheck": "tsc -p tsconfig.json && tsc -p apps/web/tsconfig.json"` to `"typecheck": "tsc -p tsconfig.json"`.
4. Add to `"dependencies"`: `"hast-util-to-html": "^9.0.5"`, `"mdast-util-to-hast": "^13.2.0"`, `"remix": "3.0.0-rc.2"` (alphabetical order, matching the existing style).

Run: `bun install`
Expected: install succeeds; `bun.lock` updates; `apps/web/node_modules` is gone.

- [ ] **Step 4: Fold the web `tsconfig` into the root one**

In `tsconfig.json`, change `"lib": ["ES2022"]` to `"lib": ["ES2022", "DOM", "DOM.Iterable"]` and add `"jsx": "react-jsx"` and `"jsxImportSource": "remix/ui"` next to the other `compilerOptions`. `include` stays `["src", "test"]`, which now covers `src/web` and `test/web`.

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Repoint the boundaries checker at `src/web`**

In `test/boundaries.test.ts`:

1. Change `const webRoot = resolve(import.meta.dir, "..", "apps", "web")` to `const webRoot = resolve(srcRoot, "web")`.
2. In `webPackages`, remove `"@lemol/todo-md/spec"`, `"@lemol/todo-md/core"`, `"@lemol/todo-md/fs"` (package-name imports are now forbidden; relatives are used). Keep `"@effect/platform-node-shared"`.
3. In `webTodoPackages`, add the three removed entries so the list reads:

```ts
const webTodoPackages = [
  "@lemol/todo-md/spec",
  "@lemol/todo-md/core",
  "@lemol/todo-md/fs",
  "@lemol/todo-md/markdown",
  "@lemol/todo-md/spec/testing",
]
```

4. In `webViolations`'s relative-import branch, allow reaching sibling modules while keeping everything else confined. Declare `const webModules = ["spec", "core", "fs"]` next to `webTodoPackages`, then use this branch:

```ts
if (specifier.startsWith(".")) {
  const target = resolve(webRoot, file.includes("/") ? dirname(file) : ".", specifier)
  if (!target.startsWith(webRoot)) {
    const srcRelative = relative(srcRoot, target)
    const targetModule = srcRelative.split(sep)[0] ?? ""
    if (!srcRelative.startsWith("..") && webModules.includes(targetModule)) {
      if (isTestingFile(target) && !isTest) {
        return [`${file}: runtime code imports test helpers (${specifier})`]
      }
      return []
    }
    return [`${file}: imports ${specifier}, outside src/web`]
  }
  return []
}
```

(`srcRoot`, `relative`, `sep`, `dirname`, `isTestingFile` are already in scope in that file.)

5. Rewrite the two web checker unit tests to the new semantics:

```ts
test("web reaches sibling modules through relative paths", () => {
  expect(
    webViolations("app/router.ts", 'import { TodoService } from "../../core/index.ts"'),
  ).toEqual([])
  expect(
    webViolations("app/router.ts", 'import { parseTodoFile } from "../../markdown/index.ts"'),
  ).toEqual(["app/router.ts: imports ../../markdown/index.ts, outside src/web"])
  expect(
    webViolations("app/router.ts", 'import { x } from "@lemol/todo-md/core"'),
  ).toEqual(["app/router.ts: web must not import @lemol/todo-md/core"])
  expect(webViolations("app/router.ts", 'const lazy = import("../../../package.json")')).toEqual([
    "app/router.ts: imports ../../../package.json, outside src/web",
  ])
})
```

Keep the `"web test helpers cannot leak into runtime"` test unchanged (it still passes: `bun:test`/`spec/testing` allowed only in test files).

Run: `bun test test/boundaries.test.ts test/web/`
Expected: all PASS, including the moved `routes`, `refresh`, `watch`, `router`, `security`, `ui`, `events`, `contracts`, `fs-e2e` and `server` suites.

- [ ] **Step 6: Run the full gate and commit (ask first)**

Run: `bun run check`
Expected: PASS.

```bash
git add -A
git status --short
git commit -m "Move the web app into src/web and test/web"
```

Ask before the commit. `git add -A` is safe here only if `git status --short` shows nothing unexpected; if it does, name files instead.

---

### Task 2: Add the `todo web` command

**Files:**
- Create: `src/cli/commands/web.ts`, `test/cli/web.test.ts`
- Modify: `src/cli/main.ts`, `test/cli/help.test.ts`, `src/web/server.ts` (delete CLI arg parsing it no longer owns), `test/web/server.test.ts` (re-target at `resolveRoot`), `src/cli/README.md`, `package.json` (drop the `web` script)
- Test: `bun test test/cli/web.test.ts test/cli/help.test.ts test/web/server.test.ts`

**Interfaces:**
- Consumes: `startServer` + `resolveRoot` from Task 1 (`src/web/server.ts`); `Dir`, `Project`, `CliContext`, `output` from `src/cli/context.ts`; `NoListFound`, `UsageError` from `src/cli/errors.ts`; `findListRoot` from `src/fs/index.ts`.
- Produces: `web` command registered in `todo`'s subcommands; `{ url }` JSON under `--json`, the `http://<host>:<port>` line (plus widen warning) for humans.

- [ ] **Step 1: Write the failing CLI tests**

Create `test/cli/web.test.ts`:

```ts
import { expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { diskWith } from "../fs/helpers.ts"
import { todo } from "./harness.ts"

effectTest(
  "web --help describes the server and its flags",
  Effect.gen(function* () {
    const help = yield* todo("web", "--help")
    expect(help.code).toBe(0)
    expect(help.stdout).toContain("DESCRIPTION")
    expect(help.stdout).toContain("EXAMPLES")
    expect(help.stdout).toContain("--port")
    expect(help.stdout).toContain("--host")
  }),
  diskWith({}),
)

effectTest(
  "web rejects --project and bad ports without serving",
  Effect.gen(function* () {
    const project = yield* todo("web", "--project", "x")
    expect(project.code).toBe(2)
    expect(project.stderr).toContain("works on local lists")
    const port = yield* todo("web", "--port", "0")
    expect(port.code).toBe(2)
    expect(port.stderr).toContain("port must be an integer from 1 to 65535")
    const json = yield* todo("web", "--project", "x", "--json")
    expect(json.code).toBe(2)
    expect(JSON.parse(json.stderr)).toMatchObject({ error: { tag: "UsageError" } })
  }),
  diskWith({}),
)
```

In `test/cli/help.test.ts`, add `"web"` after `"sync"` in the expected commands array:

```ts
"projects",
"sync",
"web",
])
```

Run: `bun test test/cli/web.test.ts test/cli/help.test.ts`
Expected: FAIL — `web --help` exits 2 (unknown command) with no DESCRIPTION; `--project` stderr names the unknown command, not "works on local lists"; the commands array mismatches. Each failure is the missing command, not a typo: the harness resolves unknown subcommands to exit 2.

- [ ] **Step 2: Read the Effect guide, then implement the command**

Read `node_modules/effect/AGENTS.md` completely first, following its links as required. Then create `src/cli/commands/web.ts`:

```ts
import { Effect, Option, Path } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { findListRoot } from "../../fs/index.ts"
import { startServer } from "../../web/server.ts"
import { CliContext, Dir, output, Project } from "../context.ts"
import { NoListFound, UsageError } from "../errors.ts"

const loopback = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "::1"

export const web = Command.make(
  "web",
  {
    port: Flag.integer("port").pipe(
      Flag.withDescription("Port to listen on; the next free port is used when busy"),
      Flag.withDefault(4400),
    ),
    host: Flag.string("host").pipe(
      Flag.withDescription("Host to bind; anyone who can reach it can edit the list"),
      Flag.withDefault("127.0.0.1"),
    ),
  },
  Effect.fn(function* ({ port, host }) {
    const { cwd, env, username } = yield* CliContext
    const dir = yield* Dir
    const project = yield* Project
    if (Option.isSome(project)) {
      return yield* new UsageError({ message: "todo web works on local lists; use --dir" })
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return yield* new UsageError({ message: "port must be an integer from 1 to 65535" })
    }
    const path = yield* Path.Path
    const root = Option.isSome(dir)
      ? path.resolve(cwd, dir.value)
      : yield* findListRoot(cwd).pipe(
        Effect.flatMap((found) =>
          Option.isSome(found) ? Effect.succeed(found.value) : new NoListFound({ cwd })
        ),
      )
    const started = yield* Effect.acquireRelease(
      Effect.promise(() =>
        startServer({
          cwd,
          ...(Option.isSome(dir) ? { dir: dir.value } : {}),
          port,
          host,
          env,
          username,
        })
      ),
      (handle) => Effect.promise(() => handle.close()),
    )
    const url = `http://${host}:${started.port}`
    yield* output(undefined, { url }, () =>
      loopback(host)
        ? [url]
        : [url, "Warning: anyone who can reach this address can edit the list."])
    yield* Effect.never
  }),
).pipe(
  Command.withDescription("Start the local web UI over the current list"),
  Command.withExamples([
    { command: "todo web --dir todo", description: "Serve the board for ./todo/TODO.md" },
    { command: "todo web --port 4410", description: "Serve on port 4410" },
  ]),
)
```

Notes for the implementer: `Flag.integer` rejects `--port nope` at parse time (exit 2) before the handler runs, so the handler's range check only sees integers. `findListRoot` needs `FileSystem`/`Path`, which `BunServices.layer` provides in `bin.ts` and in the test harness. `output(undefined, { url }, ...)` prints `{"url": "..."}` under `--json` and the human lines otherwise. `Effect.never` keeps serving until Ctrl-C; interruption runs the release (`app.close()`, runtime dispose, watcher close, `server.stop()`).

Register it in `src/cli/main.ts`: add `import { web } from "./commands/web.ts"` and append `web` after `sync` in the `Command.withSubcommands` list.

Run: `bun test test/cli/web.test.ts test/cli/help.test.ts`
Expected: PASS. (`--port nope` also exits 2 via framework parsing — regression coverage only, since it exits 2 for the wrong reason pre-implementation.)

- [ ] **Step 3: Delete the arg parsing the CLI now owns**

In `src/web/server.ts`, delete `helpText`, `parseServerOptions`, `installSignalHandlers`, `main()` and the `if (import.meta.main)` block, plus the now-unused `import { userInfo } from "node:os"`. Keep `ServerOptions`, `resolveRoot` and `startServer` byte-identical otherwise.

Rewrite `test/web/server.test.ts` against the remaining surface:

```ts
import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { resolveRoot } from "../../src/web/server.ts"

const base = { port: 4400, host: "127.0.0.1", env: {}, username: "tester" }

test("resolveRoot resolves --dir against the working directory", async () => {
  const root = await resolveRoot({ ...base, cwd: join("tmp", "work"), dir: "todo" })
  expect(root).toBe(resolve(join("tmp", "work"), "todo"))
})

test("resolveRoot discovers the checkout's own list", async () => {
  const root = await resolveRoot({ ...base, cwd: resolve(import.meta.dir, "..", "..") })
  expect(root.endsWith("todo")).toBe(true)
})

test("resolveRoot without a list throws the standard message", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "todo-md-empty-"))
  try {
    await expect(resolveRoot({ ...base, cwd })).rejects.toThrow("no todo.md list found")
  } finally {
    await rm(cwd, { recursive: true })
  }
})
```

Run: `bun test test/web/server.test.ts`
Expected: the old tests fail first (deleted imports), then PASS after the rewrite. The discovery test relies on the checkout's own `todo/TODO.md`, which is always present.

- [ ] **Step 4: Docs for the command, gate, commit (ask first)**

In `src/cli/README.md`, add to the Commands table after the `sync` row:

```
| `todo web [--port] [--host]` | Start the local web UI over the current list (`--port` default 4400, next free when busy; `--host` default 127.0.0.1). | `{ url }` |
```

Delete the `"web": "bun src/web/server.ts"` script from the root `package.json` (`todo web` is the entry now).

Run: `bun run check`
Expected: PASS.

```bash
git add src/cli/commands/web.ts src/cli/main.ts src/cli/README.md src/web/server.ts test/cli/web.test.ts test/cli/help.test.ts test/web/server.test.ts package.json
git commit -m "Add the todo web command"
```

Ask before the commit.

---

### Task 3: Docs and final cleanup

**Files:**
- Modify: `README.md`, `AGENTS.md`, `docs/architecture/README.md`, `docs/architecture/frontends.md`, `docs/architecture/tooling.md`, `src/web/README.md`
- Test: `bun run check` (docs-only; the gate is the verification)

**Interfaces:**
- Consumes: Tasks 1–2 (final paths and command surface).
- Produces: no stale `apps/web` / `bun run web` references; architecture docs describe the shipped shape.

- [ ] **Step 1: Update the user-facing docs**

1. Root `README.md`, "Using the web app" section: replace ``From a checkout, run `bun run web -- --dir todo` to open`` with ``Run `todo web --dir todo` (`bun src/cli/bin.ts web --dir todo` from source) to open``. Leave the rest of the paragraph unchanged.
2. `src/web/README.md` (moved from `apps/web/README.md`): replace the first line `Run \`bun run web -- --dir <list>\` from the repository root.` with ``Run `todo web -- --dir <list>` (or `bun src/cli/bin.ts web -- --dir <list>` from source). Defaults are`` and keep the remainder. Replace the closing `Hosting/authentication, GitHub-backed storage and a published \`todo web\` command are deferred.` with `Hosting/authentication and GitHub-backed storage are deferred (task 09).`
3. `AGENTS.md`: in the Layout block, replace `apps/web/      private local Remix web UI over one list` with `src/web/        local Remix web UI over one list (see \`todo web\`)`. In Commands, replace `bun run web -- --dir todo  # run the private local web app` with `bun src/cli/bin.ts web --dir todo  # run the local web app`.

- [ ] **Step 2: Update the architecture docs**

1. `docs/architecture/README.md` module table: replace the `` [`apps/web`](../../apps/web) `` row with `` [`src/web`](../../src/web) | — (wired by the CLI's `web` command) | `spec`, `core`, `fs` (+ `effect`, Remix, Markdown renderers; `node:`/`bun` only in `server.ts`, `watch.ts`, `app/assets.ts`) | Local web UI over one list ``. Delete the "Planned rows are not enforced yet" sentence's `apps/web` implication only if it names it (it doesn't — leave it).
2. `docs/architecture/frontends.md` web section: replace the first paragraph (private workspace member, outside the published package) with: `` `src/web` ships in the published package and is served by the `todo web` command (`src/cli/commands/web.ts`), which builds the `ManagedRuntime` (TodoService + FsTodoStore + BunServices), creates the file watcher and hands both to `createAppRouter`. The router never sees `FsTodoStore`. `` Keep the Live-changes, Forms and Security paragraphs; update the Details link to `[src/web/README.md](../../src/web/README.md)`.
3. `docs/architecture/tooling.md`: replace these exact lines (note the line break):

```
Apps under `apps/*` (the web app) are private workspace members. Git
consumers of `@lemol/todo-md` never install them, so the published package
does not depend on Remix.
```

with `The web UI lives in \`src/web\` and ships in the published package, so \`remix\` (exact) and the Markdown renderer packages are runtime dependencies.` Replace `` tests live in `test/<module>/`, mirroring `src/`; the web app's `` + `` in `apps/web/test/`. `` (one sentence across a line break) with `` tests live in `test/<module>/`, mirroring `src/`. `` In the strategy table, change the `` `apps/web` `` row label to `` `web` ``.

- [ ] **Step 3: Sweep for stale references, gate, commit (ask first)**

Run: `grep -rn "apps/web\|bun run web" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.json" . | grep -v node_modules | grep -v docs/superpowers/`
Expected: no output (history in `docs/superpowers/` intentionally keeps the old names).

Run: `bun run check`
Expected: PASS.

```bash
git add README.md AGENTS.md docs/architecture/README.md docs/architecture/frontends.md docs/architecture/tooling.md src/web/README.md
git commit -m "Document todo web in its shipped shape"
```

Ask before the commit. Afterwards, mark task 11 done via the CLI (`bun src/cli/bin.ts done 11`) only when you confirm the Done-when items in the spec hold.

