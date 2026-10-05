# Cross-Project Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable tasks in one project list to depend on tasks in other projects (`<project>:<id>`), resolving readiness through the hub and providing warnings on unresolvable references without failing checks.

**Architecture:** Project reference parsing and types live in `spec` and re-export to `hub`, allowing `markdown` to parse and minimal-diff format qualified IDs without boundary violations. `core` defines a `DependencyResolver` service that `TodoService` consumes optionally (defaulting to standalone unresolvable warnings), and `Hub` implements it across projects with cross-project cycle detection. The CLI fixes the command-retargeting bug in `add`/`edit`/`mv` so `--depends-on <project>:<id>` stores qualified references on the target project, `show`/`ls` render foreign IDs qualified, and `todo done other:7` reports newly ready tasks across projects.

**Tech Stack:** TypeScript, Bun (`bun:test`), Effect 4 (`effect`, `effect/cli`, `@effect/platform-bun`), YAML (`yaml`), MDAST.

**Spec:** [`docs/spec.md`](../../spec.md) and [`todo/hub-and-sources/35-support-dependencies-on-tasks-in-other-projects.md`](../../../todo/hub-and-sources/35-support-dependencies-on-tasks-in-other-projects.md).

## Task Shape

Cross-project dependency resolution spanning parser, core derived state, hub registry, and CLI presentation.

## Global Constraints

- Module graph: `test/boundaries.test.ts` enforces module import boundaries; relative imports only, no `@lemol/todo-md/...` self-imports.
- Minimal diffs: Markdown writers splice text and YAML keys; never re-serialize whole documents.
- Effect version: Effect 4 exact peer dependency matching other lemol repositories.
- Test isolation: Every test and spawned process must use isolated temporary home directories via `Disk` and `harness.ts`.
- Diagnostic severity: Foreign reference failures (unknown project, unsynced remote, missing task ID) yield warnings, never errors that fail `todo check`.

---

## Verification Instructions for Implementer

Do not run the project's whole gate (`bun run check`). Run static checks and focused tests as separate commands:
1. Static check 1 (lint): `bun run lint` (or `biome check src test`).
2. Static check 2 (typecheck): `bun x tsc --noEmit`.
3. Focused tests: Run only tests touching changed files, values, or guards:
   - `bun test test/boundaries.test.ts`
   - `bun test test/markdown/metadata.test.ts test/markdown/taskFile.test.ts`
   - `bun test test/core/check.test.ts test/core/views.test.ts test/core/TodoService.test.ts`
   - `bun test test/hub/refs.test.ts test/hub/Hub.test.ts`
   - `bun test test/cli/tasks.test.ts test/cli/query.test.ts test/cli/help.test.ts`
   Search `src/` and `test/` for any modified symbol/default to confirm no unverified callers exist.

---

### Task 1: Spec and Reference Types

**Files:**
- Modify: `docs/spec.md:112-220,330-415`
- Modify: `docs/superpowers/specs/2026-09-13-hub-design.md:29-37`
- Create: `src/spec/ref.ts`
- Modify: `src/spec/index.ts:1-15`
- Modify: `src/hub/refs.ts:1-23`
- Test: `test/hub/refs.test.ts`
- Test: `test/boundaries.test.ts`

**Interfaces:**
- Consumes: `docs/spec.md` §1.3, §1.6, §2.5, §2.6
- Produces: `src/spec/ref.ts` exporting `isValidName(name: string): boolean`, `TaskRef { project?: string; id: string }`, `formatRef(project: string, id: string): string`, `parseRef(text: string): TaskRef`.

**Decisions:**
- Lift the hub design non-goal in `docs/superpowers/specs/2026-09-13-hub-design.md`.
- Place `TaskRef`, `isValidName`, `parseRef`, `formatRef` in `src/spec/ref.ts` so `spec`, `markdown`, `core`, `hub`, and `cli` share them without boundary violations.
- Add `unresolvable-project` diagnostic (warning) and specify that foreign dependency failures warn rather than produce fatal errors.

- [ ] **Step 1: Write the failing test**

```ts
// test/hub/refs.test.ts
import { describe, expect, test } from "bun:test"
import { formatRef, isValidName, parseRef } from "../../src/spec/index.ts"

describe("spec refs", () => {
  test("exports ref parsing and validation from spec", () => {
    expect(isValidName("slash-usage")).toBe(true)
    expect(isValidName("Invalid Name")).toBe(false)
    expect(parseRef("slash-usage:1")).toEqual({ project: "slash-usage", id: "1" })
    expect(formatRef("slash-usage", "1")).toBe("slash-usage:1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/hub/refs.test.ts`
Expected: FAIL (unobserved: import `{ isValidName }` from `../../src/spec/index.ts` is not yet exported).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/spec/ref.ts
export const isValidName = (name: string): boolean => /^[a-z0-9][a-z0-9-]*$/.test(name)
export interface TaskRef { readonly project?: string; readonly id: string }
export const formatRef = (project: string, id: string): string => `${project}:${id}`
export const parseRef = (text: string): TaskRef => {
  const colon = text.indexOf(":")
  const project = text.slice(0, colon)
  const id = text.slice(colon + 1)
  return colon > 0 && isValidName(project) && id !== "" ? { project, id } : { id: text }
}
```
Re-export `isValidName`, `TaskRef`, `formatRef`, `parseRef` from `src/spec/index.ts`. In `src/hub/refs.ts`, re-export them from `../spec/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/hub/refs.test.ts test/boundaries.test.ts`
Expected: PASS with 0 boundary violations.

- [ ] **Step 5: Verification and Evidence**

Base commit observed output:
Command: `bun test test/boundaries.test.ts`
Observed: `12 pass, 0 fail, 33 expect() calls`
Known-bad case:
Command: `bun test test/boundaries.test.ts -t "rejects forbidden modules"`
Observed: `1 pass, 11 filtered out, 0 fail` (verified boundary enforcer flags illicit cross-imports).

- [ ] **Step 6: Commit**

```bash
git add docs/spec.md docs/superpowers/specs/2026-09-13-hub-design.md src/spec/ref.ts src/spec/index.ts src/hub/refs.ts test/hub/refs.test.ts
git commit -m "feat(spec): add task reference types and spec updates for foreign dependencies"
```

---

### Task 2: Markdown Parsing and Serialization of Qualified Dependencies

**Files:**
- Modify: `src/markdown/ids.ts:1-23`
- Modify: `src/markdown/metadata.ts:1-95`
- Modify: `src/markdown/taskFile.ts:115-270`
- Test: `test/markdown/metadata.test.ts`
- Test: `test/markdown/taskFile.test.ts`

**Interfaces:**
- Consumes: `parseRef` and `isValidName` from `../spec/index.ts`.
- Produces: `parseDependencyId(value: string): TaskId | undefined` in `src/markdown/ids.ts`.

**Decisions:**
- `parseDependencyId` accepts digits (`"07"` -> `"7"`) or qualified refs (`"slash-usage:1"`).
- In `src/markdown/taskFile.ts`, serialize numeric task IDs as numbers in YAML and string/qualified task IDs as strings, preventing `NaN` / `.nan`.
- `updateTaskFile` updates `fields.depends_on` preserving string IDs without numeric coercion.

- [ ] **Step 1: Write the failing test**

```ts
// test/markdown/metadata.test.ts addition
test("parseMetadataLine > accepts qualified foreign task IDs in depends_on", () => {
  const parsed = parseMetadataLine("#bug depends_on:1,slash-usage:2,work:PROJ-7")
  expect(parsed?.fields.dependsOn).toEqual(["1", "slash-usage:2", "work:PROJ-7"])
  expect(parsed?.diagnostics).toEqual([])
})

// test/markdown/taskFile.test.ts addition
test("parseTaskFile and formatTaskFile > round-trips qualified foreign dependencies without NaN", () => {
  const file = "---\ntitle: Task with foreign dependency\ndepends_on: [1, slash-usage:2]\n---\nBody\n"
  const parsed = parseTaskFile(file, "test.md")
  expect(parsed.dependsOn).toEqual(["1", "slash-usage:2"])
  expect(parsed.diagnostics).toEqual([])
  const formatted = formatTaskFile(parsed)
  expect(formatted).toContain("depends_on: [1, slash-usage:2]")
  expect(formatted).not.toContain(".nan")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/markdown/metadata.test.ts test/markdown/taskFile.test.ts`
Expected: FAIL with `invalid-metadata: depends_on must list task IDs: 1,slash-usage:2,work:PROJ-7` and `depends_on: [.nan]`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/markdown/ids.ts
export const parseDependencyId = (value: string): TaskId | undefined => {
  const ref = parseRef(value)
  if (ref.project !== undefined) return value
  return parseId(value)
}
// src/markdown/taskFile.ts serialization
const toYamlId = (id: TaskId) => (/^\d+$/.test(id) ? Number(id) : id)
// in entries: [["depends_on", content.dependsOn.map(toYamlId)] as const]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/markdown/metadata.test.ts test/markdown/taskFile.test.ts`
Expected: PASS (48+ tests pass, 0 fail).

- [ ] **Step 5: Verification and Evidence**

Base commit observed output:
Command: `bun -e 'import { parseMetadataLine } from "./src/markdown/metadata.ts"; console.log(JSON.stringify(parseMetadataLine("depends_on:slash-usage:1")))'`
Observed: `{"fields":{"tags":[],"dependsOn":[],"extra":{}},"diagnostics":[{"severity":"error","code":"invalid-metadata","message":"depends_on must list task IDs: slash-usage:1"}]}`
Command: `bun -e 'import { formatTaskFile } from "./src/markdown/taskFile.ts"; console.log(formatTaskFile({ title: "T", tags: [], dependsOn: ["slash-usage:1"], extra: {}, description: "", comments: [] }))'`
Observed: `depends_on: [.nan]`
Known-bad case:
Command: `bun -e 'import { parseTaskFile } from "./src/markdown/taskFile.ts"; console.log(JSON.stringify(parseTaskFile("---\ntitle: T\ndepends_on: [\"slash-usage:1\"]\n---\n", "")))'`
Observed: `{"title":"T","tags":[],"dependsOn":[],"extra":{},"description":"","comments":[],"diagnostics":[{"severity":"error","code":"invalid-frontmatter","message":"depends_on must be a list of task IDs","file":"","line":1}]}`

- [ ] **Step 6: Commit**

```bash
git add src/markdown/ids.ts src/markdown/metadata.ts src/markdown/taskFile.ts test/markdown/metadata.test.ts test/markdown/taskFile.test.ts
git commit -m "feat(markdown): parse and format qualified task dependencies"
```

---

### Task 3: Core Dependency Resolver and Model Diagnostics

**Files:**
- Create: `src/core/resolver.ts`
- Modify: `src/core/index.ts:1-20`
- Modify: `src/core/views.ts:1-60`
- Modify: `src/core/check.ts:1-75`
- Modify: `src/core/TodoService.ts:130-240`
- Test: `test/core/check.test.ts`
- Test: `test/core/views.test.ts`
- Test: `test/core/TodoService.test.ts`

**Interfaces:**
- Consumes: `parseRef` from `../spec/index.ts`.
- Produces: `DependencyResolver` Context service in `src/core/resolver.ts`:
  - `satisfied: (foreignIds: ReadonlyArray<TaskId>) => Effect.Effect<ReadonlySet<TaskId>, StoreError>`
  - `resolve: (foreignIds: ReadonlyArray<TaskId>) => Effect.Effect<ReadonlyMap<TaskId, { title?: string; state: TaskState | "unknown" | "cancelled" }>, StoreError>`
  - `diagnostics: (tasks: ReadonlyArray<Task>) => Effect.Effect<ReadonlyArray<Diagnostic>, StoreError>`
  - `unblocked: (completedRef: TaskRef) => Effect.Effect<ReadonlyArray<TaskView>, StoreError>`

**Decisions:**
- `modelDiagnostics` in `src/core/check.ts` ignores foreign dependencies for local `unknown-dependency` errors. Standalone fallback (when no `DependencyResolver` is provided) yields `severity: "warning", code: "unresolvable-project"`.
- `board` in `TodoService` queries `resolver.satisfied(foreignIds)` to derive `ready` vs `blocked`.
- `show` in `TodoService` uses `resolver.resolve(foreignIds)` to populate `dependencies`.

- [ ] **Step 1: Write the failing test**

```ts
// test/core/check.test.ts addition
test("modelDiagnostics > treats unresolvable foreign dependency as warning, not error", () => {
  const task: Task = {
    id: "1",
    title: "Needs foreign task",
    description: "",
    status: "open",
    tags: [],
    dependsOn: ["slash-usage:1"],
    comments: [],
    extra: {},
  }
  const diagnostics = modelDiagnostics([task])
  expect(diagnostics).toEqual([
    {
      severity: "warning",
      code: "unresolvable-project",
      message: "task 1 depends on unresolvable project slash-usage",
      taskId: "1",
    },
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/core/check.test.ts`
Expected: FAIL with `received: [{"code": "unknown-dependency", "severity": "error"}]`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/resolver.ts
export class DependencyResolver extends Context.Service<DependencyResolver, {
  readonly satisfied: (ids: ReadonlyArray<TaskId>) => Effect.Effect<ReadonlySet<TaskId>, StoreError>
  readonly resolve: (ids: ReadonlyArray<TaskId>) => Effect.Effect<ReadonlyMap<TaskId, { title?: string; state: TaskState | "unknown" | "cancelled" }>, StoreError>
  readonly diagnostics: (tasks: ReadonlyArray<Task>) => Effect.Effect<ReadonlyArray<Diagnostic>, StoreError>
  readonly unblocked: (completed: TaskRef) => Effect.Effect<ReadonlyArray<TaskView>, StoreError>
}>()("@lemol/todo-md/core/DependencyResolver") {}
```
In `src/core/check.ts`, skip foreign IDs in local `counts.has(dependency)` check and emit `unresolvable-project` warning when unhandled. In `src/core/TodoService.ts`, inject `Option.fromNullable(yield* Effect.serviceOption(DependencyResolver))`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/core/check.test.ts test/core/views.test.ts test/core/TodoService.test.ts`
Expected: PASS (30+ pass, 0 fail).

- [ ] **Step 5: Verification and Evidence**

Base commit observed output:
Command: `bun -e 'import { modelDiagnostics } from "./src/core/check.ts"; console.log(JSON.stringify(modelDiagnostics([{ id: "1", title: "T", status: "open", tags: [], dependsOn: ["slash-usage:1"], comments: [], extra: {} }])))'`
Observed: `[{"severity":"error","code":"unknown-dependency","message":"task 1 depends on unknown task slash-usage:1","taskId":"1"}]`
Known-bad case:
Command: `bun test test/core/check.test.ts -t "reports dependencies on unknown IDs"`
Observed: `1 pass, 7 filtered out, 0 fail` (verified local unknown dependencies are strictly errors).

- [ ] **Step 6: Commit**

```bash
git add src/core/resolver.ts src/core/index.ts src/core/views.ts src/core/check.ts src/core/TodoService.ts test/core/check.test.ts test/core/views.test.ts test/core/TodoService.test.ts
git commit -m "feat(core): introduce DependencyResolver and foreign dependency diagnostics"
```

---

### Task 4: Hub Cross-Project Dependency Resolution and Cycle Detection

**Files:**
- Create: `src/hub/dependencies.ts`
- Modify: `src/hub/Hub.ts:210-270`
- Test: `test/hub/Hub.test.ts`

**Interfaces:**
- Consumes: `DependencyResolver` from `../core/index.ts`, `find` and `serviceOf` in `Hub.ts`.
- Produces: `makeDependencyResolver(currentProject: string, hub: HubContext)` creating `DependencyResolver.layer` for `TodoService`.

**Decisions:**
- A foreign dependency is satisfied iff that task is done with `outcome !== "cancelled"`.
- If a project is unknown in the registry, diagnostic is `unresolvable-project` (warning).
- If a project exists but the task ID is missing, diagnostic is `unknown-dependency` (warning).
- If the foreign task is cancelled, diagnostic is `cancelled-dependency` (warning).
- Build a multi-project dependency graph and detect cycles with `findCycle`; emit `dependency-cycle` (error) naming the cycle.

- [ ] **Step 1: Write the failing test**

```ts
// test/hub/Hub.test.ts addition
effectTest("evaluates cross-project dependencies across registered projects", Effect.gen(function* () {
  const hub = yield* Hub
  yield* hub.add({ name: "upstream", source: "fs", config: { dir: "upstream" } })
  yield* hub.add({ name: "downstream", source: "fs", config: { dir: "downstream" } })
  const upstream = yield* hub.todo("upstream")
  const downstream = yield* hub.todo("downstream")

  const t1 = yield* upstream.add({ title: "Upstream task" })
  const t2 = yield* downstream.add({ title: "Downstream task", dependsOn: [`upstream:${t1.id}`] })

  // Held back while upstream is open
  const nextBefore = yield* downstream.next()
  expect(nextBefore.some((v) => v.task.id === t2.id)).toBe(false)

  // Satisfied once upstream is completed
  yield* upstream.complete(t1.id)
  const nextAfter = yield* downstream.next()
  expect(nextAfter.some((v) => v.task.id === t2.id)).toBe(true)
}), diskWith({
  "upstream/TODO.md": "# Upstream\n",
  "downstream/TODO.md": "# Downstream\n",
}))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/hub/Hub.test.ts -t "evaluates cross-project dependencies"`
Expected: FAIL (unobserved: `nextAfter` does not include `t2` because foreign dependencies are not yet evaluated across projects).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hub/dependencies.ts
export const makeDependencyResolver = (
  project: string,
  deps: { find: (name: string) => Effect.Effect<Project, unknown>; serviceOf: (p: Project) => Effect.Effect<TodoService["Service"], unknown>; registered: Effect.Effect<ReadonlyArray<Project>, unknown> },
) => Layer.succeed(DependencyResolver, {
  satisfied: (ids) => /* resolve foreign task and check done with outcome !== cancelled */,
  resolve: (ids) => /* query foreign project service and get task title and state */,
  diagnostics: (tasks) => /* check project existence, task existence, cancelled status, and cross-project cycles */,
  unblocked: (completed) => /* inspect all registered projects for tasks waiting on completed */,
})
```
Provide this layer when instantiating `TodoService.layer` in `src/hub/Hub.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/hub/Hub.test.ts`
Expected: PASS (all Hub tests pass).

- [ ] **Step 5: Verification and Evidence**

Base commit observed output:
Command: `bun test test/hub/Hub.test.ts -t "todo opens a service"`
Observed: `1 pass, 35 filtered out, 0 fail`
Known-bad case:
Command: `bun test test/hub/Hub.test.ts -t "fails for an unknown project"`
Observed: `1 pass, 35 filtered out, 0 fail` (verified missing project lookup behaves as expected).

- [ ] **Step 6: Commit**

```bash
git add src/hub/dependencies.ts src/hub/Hub.ts test/hub/Hub.test.ts
git commit -m "feat(hub): cross-project dependency evaluation and cycle detection"
```

---

### Task 5: CLI Retargeting Bug Fix and Presentation

**Files:**
- Modify: `src/cli/commands/tasks.ts:90-145,220-260,290-320,410-440`
- Modify: `src/cli/render.ts:18-65,185-205`
- Test: `test/cli/tasks.test.ts`
- Test: `test/cli/query.test.ts`
- Test: `test/cli/help.test.ts`

**Interfaces:**
- Consumes: `withTodo`, `projectOfRefs`, `formatRef`, `showId`.
- Produces: CLI commands `add`, `edit`, `mv`, `done` with correct target scoping and qualified rendering.

**Decisions:**
- In `add` and `edit`, do not include `dependsOn` or `dropDependency` in `projectOfRefs`.
- Storing dependencies: if `ref.project !== undefined && ref.project !== targetProject.name`, store `formatRef(ref.project, ref.id)`; otherwise store local `ref.id`.
- If an anchor (`before`, `after`) specifies a project that disagrees with target, return `UsageError`.
- In `showId`: if ID is qualified `<project>:<id>`, format as `${project}:${showId(id)}`.
- In `renderCompletions`: render unblocked tasks from foreign projects qualified (`formatRef(view.project, showId(view.task.id))`).

- [ ] **Step 1: Write the failing test**

```ts
// test/cli/tasks.test.ts addition
effectTest(
  "todo add with cross-project dependency does not retarget and holds task back",
  Effect.gen(function* () {
    const { root } = yield* Disk
    const home = `${root}/home`
    yield* runTodo(["projects", "add", "w", "--name", "workspace"], { home })
    yield* runTodo(["projects", "add", "s", "--name", "slash-usage"], { home })

    // Add task to workspace depending on slash-usage:1
    const addResult = yield* runTodo(
      ["add", "Dependent Task", "--project", "workspace", "--quick", "--depends-on", "slash-usage:1"],
      { home },
    )
    expect(addResult.code).toBe(0)
    expect(addResult.stdout).toContain("Added 01  Dependent Task")

    // Verify task is held back in workspace
    const nextBefore = yield* runTodo(["next", "--project", "workspace"], { home })
    expect(nextBefore.stdout).toBe("Nothing is ready.")

    // Complete task in slash-usage and verify newly ready task in workspace
    yield* runTodo(["add", "Blocking Task", "--project", "slash-usage", "--quick"], { home })
    const doneResult = yield* runTodo(["done", "slash-usage:1"], { home })
    expect(doneResult.stdout).toContain("workspace:01  Dependent Task")
  }),
  diskWith({
    "w/TODO.md": "# Workspace\n",
    "s/TODO.md": "# Slash Usage\n",
  }),
)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/cli/tasks.test.ts -t "cross-project dependency does not retarget"`
Expected: FAIL with `error: task project slash-usage contradicts --project workspace`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cli/commands/tasks.ts (add)
const dependsOn = flags.dependsOn.map(refOf)
const before = Option.map(flags.before, refOf)
const after = Option.map(flags.after, refOf)
// Do NOT include dependsOn in projectOfRefs
const refProject = yield* projectOfRefs([...Option.toArray(before), ...Option.toArray(after)])
// In withTodo:
const toStoredId = (ref: TaskRef) =>
  ref.project !== undefined && ref.project !== project.name ? formatRef(ref.project, ref.id) : ref.id
yield* todo.add({
  ...,
  ...(dependsOn.length > 0 ? { dependsOn: dependsOn.map(toStoredId) } : {}),
})
```
Fix `edit` similarly: only `id` sets `projectOfRefs`. Update `showId` in `src/cli/render.ts` to format qualified IDs.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/cli/tasks.test.ts test/cli/query.test.ts test/cli/help.test.ts`
Expected: PASS (all tests pass, 0 fail).

- [ ] **Step 5: Verification and Evidence**

Base commit observed output:
Command: `tmp=$(mktemp -d); TODO_MD_HOME="$tmp" bun src/cli/bin.ts add "Test" --quick --project workspace --depends-on slash-usage:01; rm -rf "$tmp"`
Observed: `error: task project slash-usage contradicts --project workspace`
Command: `tmp=$(mktemp -d); mkdir -p "$tmp/todo"; echo "# test" > "$tmp/todo/TODO.md"; bun src/cli/bin.ts add "Test" --quick --dir "$tmp/todo" --depends-on slash-usage:01; rm -rf "$tmp"`
Observed: `error: use --project or --dir, not both`
Known-bad case:
Command: `bun test test/cli/tasks.test.ts -t "contradictory edit"`
Observed: `1 pass, 26 filtered out, 0 fail` (verified CLI usage errors function properly).

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/tasks.ts src/cli/render.ts test/cli/tasks.test.ts
git commit -m "fix(cli): resolve cross-project dependency retargeting and rendering"
```
