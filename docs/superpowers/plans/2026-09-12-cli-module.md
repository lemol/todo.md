# cli Module Implementation Plan (Plan 5 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@lemol/todo-md/cli`, the `todo` command, for people and agents:
- an outline view of the list;
- `--json` on every command;
- `--help` with examples on every command;
- stable exit codes;
- an executable wired through `package.json`'s `bin`.

**Architecture:**
- **Commands** are built with `effect/unstable/cli`.
- **`main(args, context)`** runs the command tree with `Command.runWith` and returns an exit code, so every command is tested end to end against temporary lists.
- **Each command** finds the list (`--dir`, or discovery from the working directory) and runs against `TodoService` over `FsTodoStore`, via `withTodo`.
- **Output:** pure functions render human output; `--json` prints the result as-is.
- **`bin.ts`** is a thin executable that passes in the process's arguments, working directory, environment and TTY state, and sets the exit code.

**Tech Stack:** Bun 1.4, TypeScript 7, Effect `4.0.0-rc.108` (`effect/unstable/cli`: `Command`, `Flag`, `Argument`, `GlobalFlag`, `CliOutput`), `@effect/platform-bun` (`BunServices`, `BunRuntime`), `bun:test`, Biome.

**Spec:**
- [`docs/architecture.md`](../../architecture.md): "cli".
- [`src/cli/README.md`](../../../src/cli/README.md): the command surface (Task 5 rewrites it to match).
- Plans 1–4 built what the CLI composes: `core` (`TodoService`) and `fs` (`FsTodoStore`, `findListRoot`, `initList`, `normalize`).

**Where this plan sits:**

1. `spec` (done)
2. `markdown` (done)
3. `fs` (done)
4. `core` (done)
5. `cli` (this plan)

## Global Constraints

- **Imports.** `src/cli/**` may import `../spec/index.ts`, `../core/index.ts`, `../fs/index.ts`, `effect` (including `effect/unstable/cli`), `@effect/platform-bun`, `node:*` and `bun`, but not `../markdown`. `test/boundaries.test.ts` enforces this.
- **Read the Effect guide first.** Read `node_modules/effect/AGENTS.md` before writing Effect code. Services are yielded directly (`yield* TodoService`) and have no `.asEffect()`.
- **No raw control characters in source.** Write ANSI escapes as the `\u001b` escape sequence in strings, never as literal escape bytes.
- **Formatting.** Biome: double quotes, no semicolons, 2-space indent, width 100. Run `bun run fix` after editing; code here is already formatted.
- **Gate.** `bun run check` must pass before every commit.
- **Commits.** Commit messages are plain sentences ending with:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK
  ```

## Decisions

**Chosen by the user:**
- **Human output mirrors `TODO.md`.** A title, then sections as headings, one line per task (`  02  Add rate limiting   #api`), `blocked by …` under blocked tasks, and a summary (`4 open · 3 ready · 1 blocked`). Colors only on a terminal, never with `NO_COLOR`.
- **`--json` prints the raw result on stdout.** Failures print `{"error":{"tag","message",…}}` on stderr with a non-zero exit code. Output is one line of JSON; dates are ISO 8601 (`DateTime` serializes itself).
- **Every command has `--help`** with a description, a description for each flag and argument, and examples. `test/cli/help.test.ts` walks every command listed by `todo --help`, so a new command without help fails it.

**Made by this plan** (Task 5 writes them into the CLI README):
- **Exit codes:**

  | Code | Meaning |
  | --- | --- |
  | 0 | Success. |
  | 1 | The operation failed, or `check` found errors. The message is on stderr. |
  | 2 | Usage error: an unknown command, a bad flag, or contradictory flags. |

  `todo check` prints its diagnostics and then exits 1 on errors, without repeating them on stderr.
- **`--json` and `--dir` are global flags** (`GlobalFlag.setting`), accepted anywhere on the command line. `--author` belongs to `comment` only. The old README listed it as global.
- **Forgiving arguments:**
  - IDs may be typed padded (`07`) or bare (`7`).
  - `add` titles and `comment` text are variadic words joined with spaces, so quotes are optional.
- **`edit` flags:** `--title`, `--description`, `--tag`/`--untag`, `--assignee`/`--unassign`, `--depends-on`/`--drop-dependency`. `add --file` is dropped: whether a task gets a file is the store's decision (spec §2.9).
- **`next`** shows 1 task by default; `--limit n` shows more, and 0 shows all.
- **`mv`** takes exactly one of `--top`, `--bottom`, `--before`, `--after`, `--group` or `--ungrouped`.
- **`init [dir]`** defaults to `./todo`, with the working directory's name as the title.
- **`bin`:** `package.json` gets `"bin": { "todo": "./src/cli/bin.ts" }`, and `bin.ts` is committed as executable.
- **Version:** the version lives in `main.ts`, and a test keeps it equal to `package.json`'s.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/cli/style.ts` | `Style`, `styleFor(color)`: ANSI or plain |
| `src/cli/render.ts` | `showId`, `label`, `taskLines`, `renderListing`, `renderDetail`, `renderCompletions`, `renderDiagnostics` |
| `src/cli/errors.ts` | `NoListFound`, `UsageError`, `ProblemsFound`, `describeError`, `errorJson`, `exitCodeOf` |
| `src/cli/context.ts` | `CliContext`, the global flags `Json` and `Dir`, `taskId`, `listRoot`, `withTodo`, `output`, `author` |
| `src/cli/commands/lists.ts` | `init`, `fmt` |
| `src/cli/commands/query.ts` | `list`/`ls`, `next`, `show`, `check`, `showList` |
| `src/cli/commands/tasks.ts` | `add`, `edit`, `done`, `reopen`, `mv`, `rm`, `comment` |
| `src/cli/main.ts` | The `todo` command tree, `version`, and `main(args, context)` → exit code |
| `src/cli/bin.ts` | The executable |
| `src/cli/index.ts` | Public entry point `@lemol/todo-md/cli` |
| `test/cli/harness.ts` | `runTodo(args, options)` / `todo(...args)`: run `main` in a test directory and capture stdout, stderr and the code |
| `test/cli/fixtures.ts` | `acme`, a sample list, and `lines` |

`src/cli/index.ts` exists today as an `export {}` placeholder. Tests reuse `diskWith`, `Disk` and `md` from `test/fs/helpers.ts`, and `task` from `test/core/fixtures.ts`.

---

### Task 1: Output and errors

**Files:**
- Create: `src/cli/style.ts`, `src/cli/render.ts`, `src/cli/errors.ts`
- Test: `test/cli/render.test.ts`, `test/cli/errors.test.ts`

**Interfaces:**
- Consumes: `TaskView`, `Listing`, `TaskDetail`, `Completion` and `viewOf` from `core`; `Task` and `Diagnostic` from `spec`.
- Produces:
  - `interface Style { bold; dim; red; yellow; green }` and `styleFor(color)`.
  - `showId(id)`, which pads numeric IDs to 2 digits, and `label(task)` → `"02  Title"`.
  - `taskLines(views, style): string[]`
  - `renderListing(listing, style)`, `renderDetail(detail, style)`, `renderCompletions(completions, style)` and `renderDiagnostics(diagnostics, style)`, each returning `string[]`.
  - Errors (all `Schema.TaggedError`): `NoListFound { cwd }`, `UsageError { message }`, `ProblemsFound { errors }`.
  - `describeError(error): string`, `errorJson(error)` and `exitCodeOf(error): 1 | 2`.

- [ ] **Step 1: Write the failing tests**

Create `test/cli/render.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import {
  label,
  renderCompletions,
  renderDetail,
  renderDiagnostics,
  renderListing,
  showId,
  taskLines,
} from "../../src/cli/render.ts"
import { styleFor } from "../../src/cli/style.ts"
import { viewOf } from "../../src/core/index.ts"
import { task } from "../core/fixtures.ts"

const plain = styleFor(false)
const done = new Set(["1"])
const ready = viewOf(task({ id: "2", title: "Add rate limiting", tags: ["api"] }), done)
const blocked = viewOf(
  task({
    id: "3",
    title: "Fix login redirect",
    tags: ["bug"],
    assignee: "lemol",
    dependsOn: ["2"],
  }),
  done,
)

describe("names", () => {
  test("showId pads numeric IDs to two digits and leaves others alone", () => {
    expect([showId("7"), showId("12"), showId("105"), showId("PROJ-1")]).toEqual([
      "07",
      "12",
      "105",
      "PROJ-1",
    ])
  })

  test("label is the ID and title", () => {
    expect(label(ready.task)).toBe("02  Add rate limiting")
  })
})

describe("taskLines", () => {
  test("aligns extras and puts a blocked-by line under blocked tasks", () => {
    expect(taskLines([ready, blocked], plain)).toEqual([
      "  02  Add rate limiting   #api",
      "  03  Fix login redirect  #bug @lemol",
      "      blocked by 02",
    ])
  })

  test("shows a done task's completion date", () => {
    const finished = viewOf(
      task({
        id: "5",
        title: "Set up CI",
        status: "done",
        completedAt: DateTime.makeUnsafe("2026-09-10T08:00:00Z"),
      }),
      done,
    )
    expect(taskLines([finished], plain)).toEqual(["  05  Set up CI  2026-09-10"])
  })
})

describe("renderListing", () => {
  const listing = {
    title: "Acme API",
    description: "",
    sections: [
      { name: undefined, description: "", tasks: [] },
      { name: "Backend", description: "", tasks: [ready, blocked] },
      { name: "Empty", description: "", tasks: [] },
    ],
    done: [],
  }

  test("prints the title, non-empty sections and a summary", () => {
    expect(renderListing(listing, plain)).toEqual([
      "Acme API",
      "",
      "Backend",
      "  02  Add rate limiting   #api",
      "  03  Fix login redirect  #bug @lemol",
      "      blocked by 02",
      "",
      "2 open · 1 ready · 1 blocked",
    ])
  })

  test("says when there is nothing to show", () => {
    expect(renderListing({ ...listing, sections: [] }, plain)).toEqual([
      "Acme API",
      "",
      "No tasks.",
    ])
  })
})

test("renderDetail shows state, facts and dependencies", () => {
  expect(
    renderDetail(
      {
        view: blocked,
        dependencies: [{ id: "2", title: "Add rate limiting", state: "ready" }],
        blocks: [],
      },
      plain,
    ),
  ).toEqual([
    "03  Fix login redirect",
    "    blocked by 02 · #bug @lemol",
    "",
    "    Depends on",
    "      02  Add rate limiting  ready",
  ])
})

test("renderCompletions lists each completed task, then the newly ready ones once", () => {
  const unblocked = viewOf(task({ id: "3", title: "Fix login redirect" }), new Set(["2"]))
  expect(
    renderCompletions(
      [
        { task: ready.task, unblocked: [unblocked] },
        { task: task({ id: "4", title: "Other" }), unblocked: [unblocked] },
      ],
      plain,
    ),
  ).toEqual([
    "Done 02  Add rate limiting",
    "Done 04  Other",
    "Now ready:",
    "  03  Fix login redirect",
  ])
})

describe("renderDiagnostics", () => {
  test("sorts errors first and summarizes", () => {
    expect(
      renderDiagnostics(
        [
          {
            severity: "warning",
            code: "orphan-file",
            message: "no item links to x.md",
            file: "x.md",
          },
          {
            severity: "error",
            code: "broken-link",
            message: "y.md does not exist",
            file: "TODO.md",
            line: 4,
          },
          { severity: "info", code: "missing-id", message: "needs an ID", taskId: "7" },
        ],
        plain,
      ),
    ).toEqual([
      "error    TODO.md:4  broken-link  y.md does not exist",
      "warning  x.md  orphan-file  no item links to x.md",
      "info     task 07  missing-id  needs an ID",
      "",
      "1 error · 1 warning · 1 note",
    ])
  })

  test("says when there are no problems", () => {
    expect(renderDiagnostics([], plain)).toEqual(["No problems found."])
  })
})
```

Create `test/cli/errors.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import {
  describeError,
  errorJson,
  exitCodeOf,
  NoListFound,
  ProblemsFound,
  UsageError,
} from "../../src/cli/errors.ts"
import { HasDependents } from "../../src/core/index.ts"
import {
  GroupNotFound,
  InvalidTransition,
  StoreError,
  TaskNotFound,
  Unsupported,
  ValidationError,
} from "../../src/spec/index.ts"

describe("describeError", () => {
  test.each([
    [new TaskNotFound({ id: "9" }), "no task 9"],
    [new GroupNotFound({ name: "Backend" }), 'no group "Backend"'],
    [
      new InvalidTransition({ id: "2", status: "done", operation: "complete" }),
      "task 2 is done, so it cannot be completed",
    ],
    [
      new InvalidTransition({ id: "2", status: "done", operation: "move" }),
      "task 2 is done, so it cannot be moved",
    ],
    [new ValidationError({ issues: ["a", "b"] }), "invalid input: a, b"],
    [new Unsupported({ operation: "comment" }), "this list does not support comment"],
    [
      new HasDependents({ id: "2", dependents: ["3", "5"] }),
      "task 2 is needed by 3, 5; use --force to remove it anyway",
    ],
    [
      new NoListFound({ cwd: "/work" }),
      "no todo.md list found from /work; run `todo init` or pass --dir",
    ],
    [new UsageError({ message: "say where" }), "say where"],
    [new StoreError({ message: "disk full" }), "disk full"],
  ])("%s", (error, message) => {
    expect(describeError(error)).toBe(message)
  })
})

test("errorJson keeps the tag, the message and plain fields", () => {
  expect(errorJson(new HasDependents({ id: "2", dependents: ["3"] }))).toEqual({
    tag: "HasDependents",
    message: "task 2 is needed by 3; use --force to remove it anyway",
    id: "2",
    dependents: ["3"],
  })
  expect(errorJson(new StoreError({ message: "disk full", cause: new Error("x") }))).toEqual({
    tag: "StoreError",
    message: "disk full",
  })
})

test("exitCodeOf: 2 for usage errors, 1 for everything else", () => {
  expect(exitCodeOf(new UsageError({ message: "x" }))).toBe(2)
  expect(exitCodeOf({ _tag: "ShowHelp" })).toBe(2)
  expect(exitCodeOf(new TaskNotFound({ id: "9" }))).toBe(1)
  expect(exitCodeOf(new ProblemsFound({ errors: 2 }))).toBe(1)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/cli`
Expected: FAIL with `Cannot find module '../../src/cli/render.ts'` and `…/errors.ts`.

- [ ] **Step 3: Write the styling**

Create `src/cli/style.ts`:

```ts
/** Terminal styling: ANSI colors when enabled, plain text otherwise. */
export interface Style {
  readonly bold: (text: string) => string
  readonly dim: (text: string) => string
  readonly red: (text: string) => string
  readonly yellow: (text: string) => string
  readonly green: (text: string) => string
}

const ansi = (open: number, close: number) => (text: string) =>
  `\u001b[${open}m${text}\u001b[${close}m`

const plain = (text: string) => text

export const styleFor = (color: boolean): Style =>
  color
    ? {
        bold: ansi(1, 22),
        dim: ansi(2, 22),
        red: ansi(31, 39),
        yellow: ansi(33, 39),
        green: ansi(32, 39),
      }
    : { bold: plain, dim: plain, red: plain, yellow: plain, green: plain }
```

- [ ] **Step 4: Write the renderers**

Create `src/cli/render.ts`:

```ts
import { DateTime } from "effect"
import type { Completion, Listing, TaskDetail, TaskView } from "../core/index.ts"
import type { Diagnostic, Task } from "../spec/index.ts"
import type { Style } from "./style.ts"

/** A task ID as people read it: numeric IDs padded like the file format (`7` → `07`). */
export const showId = (id: string): string => (/^\d+$/.test(id) ? id.padStart(2, "0") : id)

/** `07  Title`: how every message names a task. */
export const label = (task: Task): string => `${showId(task.id)}  ${task.title}`

const day = (task: Task) =>
  task.completedAt === undefined ? "" : DateTime.formatIso(task.completedAt).slice(0, 10)

const minute = (at: DateTime.Utc) => DateTime.formatIso(at).slice(0, 16).replace("T", " ")

const meta = (task: Task): string =>
  [
    ...task.tags.map((tag) => `#${tag}`),
    ...(task.assignee === undefined ? [] : [`@${task.assignee}`]),
  ].join(" ")

const indented = (text: string, spaces: number): string[] =>
  text.split("\n").map((line) => (line === "" ? "" : `${" ".repeat(spaces)}${line}`))

/**
 * Task lines as the list shows them: `  <id>  <title>  <#tags @assignee>`,
 * titles padded so the extras line up, and a `blocked by` line under blocked
 * tasks. Done tasks show their completion date instead of tags.
 */
export const taskLines = (views: ReadonlyArray<TaskView>, style: Style): string[] => {
  const idWidth = Math.max(2, ...views.map((v) => showId(v.task.id).length))
  const titleWidth = Math.min(50, Math.max(0, ...views.map((v) => v.task.title.length)))
  return views.flatMap((v) => {
    const extra = v.state === "done" ? day(v.task) : meta(v.task)
    const title = extra === "" ? v.task.title : v.task.title.padEnd(titleWidth)
    const head = `  ${showId(v.task.id).padEnd(idWidth)}  ${title}`
    const line = extra === "" ? head : `${head}  ${style.dim(extra)}`
    if (v.state !== "blocked") return [line]
    const blocked = `blocked by ${v.blockedBy.map(showId).join(", ")}`
    return [line, `${" ".repeat(idWidth + 4)}${style.yellow(blocked)}`]
  })
}

/** `todo list`: the outline of the list, like TODO.md, and a summary line. */
export const renderListing = (listing: Listing, style: Style): string[] => {
  const lines: string[] = []
  if (listing.title !== "") lines.push(style.bold(listing.title), "")
  for (const section of listing.sections.filter((s) => s.tasks.length > 0)) {
    if (section.name !== undefined) lines.push(style.bold(section.name))
    lines.push(...taskLines(section.tasks, style), "")
  }
  if (listing.done.length > 0) {
    lines.push(style.bold("Done"), ...taskLines(listing.done, style), "")
  }
  const open = listing.sections.flatMap((section) => section.tasks)
  if (open.length === 0 && listing.done.length === 0) return [...lines, "No tasks."]
  const count = (state: string) => open.filter((v) => v.state === state).length
  const summary = [
    ...(listing.sections.length > 0
      ? [`${open.length} open`, `${count("ready")} ready`, `${count("blocked")} blocked`]
      : []),
    ...(listing.done.length > 0 ? [`${listing.done.length} done`] : []),
  ]
  return [...lines, style.dim(summary.join(" · "))]
}

/** `todo show`: one task with its state, description, dependencies and comments. */
export const renderDetail = (detail: TaskDetail, style: Style): string[] => {
  const { task, state, blockedBy } = detail.view
  const status =
    state === "blocked"
      ? style.yellow(`blocked by ${blockedBy.map(showId).join(", ")}`)
      : state === "done"
        ? style.green(`done ${day(task)}`.trim())
        : style.green("ready")
  const facts = [
    status,
    ...(task.group === undefined ? [] : [task.group]),
    ...(meta(task) === "" ? [] : [meta(task)]),
  ]
  const lines = [style.bold(label(task)), `    ${facts.join(" · ")}`]
  if (task.description !== "") lines.push("", ...indented(task.description, 4))
  if (detail.dependencies.length > 0) {
    lines.push("", "    Depends on")
    for (const d of detail.dependencies) {
      lines.push(`      ${showId(d.id)}  ${d.title ?? "(unknown task)"}  ${style.dim(d.state)}`)
    }
  }
  if (detail.blocks.length > 0) {
    lines.push("", "    Blocks")
    for (const b of detail.blocks) lines.push(`      ${label(b.task)}  ${style.dim(b.state)}`)
  }
  if (task.comments.length > 0) {
    lines.push("", "    Comments")
    for (const comment of task.comments) {
      lines.push(`      ${style.dim(`@${comment.author} at ${minute(comment.at)}`)}`)
      lines.push(...indented(comment.body, 8))
    }
  }
  return lines
}

/** `todo done`: what was completed and what became ready. */
export const renderCompletions = (
  completions: ReadonlyArray<Completion>,
  style: Style,
): string[] => {
  const completed = new Set(completions.map((c) => c.task.id))
  const ready = new Map<string, TaskView>()
  for (const view of completions.flatMap((c) => c.unblocked)) {
    if (!completed.has(view.task.id)) ready.set(view.task.id, view)
  }
  return [
    ...completions.map((c) => `Done ${label(c.task)}`),
    ...(ready.size === 0 ? [] : ["Now ready:", ...taskLines([...ready.values()], style)]),
  ]
}

const where = (d: Diagnostic): string => {
  if (d.file !== undefined) return d.line === undefined ? d.file : `${d.file}:${d.line}`
  return d.taskId === undefined ? "-" : `task ${showId(d.taskId)}`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** `todo check`: one line per diagnostic, errors first, and a summary. */
export const renderDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
  style: Style,
): string[] => {
  if (diagnostics.length === 0) return ["No problems found."]
  const rank = { error: 0, warning: 1, info: 2 } as const
  const color = { error: style.red, warning: style.yellow, info: style.dim } as const
  const sorted = [...diagnostics].sort((a, b) => rank[a.severity] - rank[b.severity])
  const count = (severity: Diagnostic["severity"]) =>
    diagnostics.filter((d) => d.severity === severity).length
  const summary = [
    ...(count("error") > 0 ? [plural(count("error"), "error")] : []),
    ...(count("warning") > 0 ? [plural(count("warning"), "warning")] : []),
    ...(count("info") > 0 ? [plural(count("info"), "note")] : []),
  ]
  return [
    ...sorted.map(
      (d) => `${color[d.severity](d.severity.padEnd(7))}  ${where(d)}  ${d.code}  ${d.message}`,
    ),
    "",
    summary.join(" · "),
  ]
}
```

- [ ] **Step 5: Write the errors**

Create `src/cli/errors.ts`:

```ts
import { Schema } from "effect"

/** No list was found by walking up from the working directory. */
export class NoListFound extends Schema.TaggedError<NoListFound>()("NoListFound", {
  cwd: Schema.String,
}) {}

/** The command line asked for nothing to do, or for contradictory things. */
export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", {
  message: Schema.String,
}) {}

/** `todo check` found errors; they were already printed. */
export class ProblemsFound extends Schema.TaggedError<ProblemsFound>()("ProblemsFound", {
  errors: Schema.Number,
}) {}

type Tagged = { readonly _tag: string } & Record<string, unknown>

const isTagged = (error: unknown): error is Tagged =>
  typeof error === "object" &&
  error !== null &&
  typeof (error as { _tag?: unknown })._tag === "string"

const pastTense: Record<string, string> = {
  move: "moved",
  complete: "completed",
  reopen: "reopened",
}

/** A one-line, human explanation of a failure. */
export const describeError = (error: unknown): string => {
  if (!isTagged(error)) return String(error)
  const text = (key: string) => String(error[key] ?? "")
  const list = (key: string) => {
    const value = error[key]
    return Array.isArray(value) ? value.join(", ") : ""
  }
  switch (error._tag) {
    case "TaskNotFound":
      return `no task ${text("id")}`
    case "GroupNotFound":
      return `no group "${text("name")}"`
    case "InvalidTransition": {
      const operation = text("operation")
      return `task ${text("id")} is ${text("status")}, so it cannot be ${pastTense[operation] ?? operation}`
    }
    case "ValidationError":
      return `invalid input: ${list("issues")}`
    case "Unsupported":
      return `this list does not support ${text("operation")}`
    case "HasDependents":
      return `task ${text("id")} is needed by ${list("dependents")}; use --force to remove it anyway`
    case "NoListFound":
      return `no todo.md list found from ${text("cwd")}; run \`todo init\` or pass --dir`
    case "ProblemsFound":
      return `check found ${text("errors")} error(s)`
    default:
      return typeof error.message === "string" && error.message !== "" ? error.message : error._tag
  }
}

const isPlain = (value: unknown) =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  Array.isArray(value)

/** The JSON form of a failure: its tag, the message, and its plain fields. */
export const errorJson = (error: unknown): Record<string, unknown> => {
  if (!isTagged(error)) return { tag: "Error", message: String(error) }
  const fields = Object.entries(error).filter(
    ([key, value]) => key !== "_tag" && key !== "message" && isPlain(value),
  )
  return { tag: error._tag, message: describeError(error), ...Object.fromEntries(fields) }
}

/** Exit codes: 0 success, 1 a failed operation or problems found, 2 a usage error. */
export const exitCodeOf = (error: unknown): number =>
  isTagged(error) && (error._tag === "ShowHelp" || error._tag === "UsageError") ? 2 : 1
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test test/cli`
Expected: `22 pass`, `0 fail`.

- [ ] **Step 7: Run the gate and commit**

```bash
bun run check
git add src/cli/style.ts src/cli/render.ts src/cli/errors.ts test/cli
git commit -m "Render todo output and describe CLI errors" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 2: The command context, `main`, `init` and `fmt`

**Files:**
- Create: `src/cli/context.ts`, `src/cli/commands/lists.ts`, `src/cli/main.ts`
- Test: `test/cli/harness.ts`, `test/cli/lists.test.ts`

**Interfaces:**
- Consumes: Task 1; `TodoService` from `core`; `FsTodoStore`, `findListRoot`, `initList` and `NormalizeReport` from `fs`.
- Produces:
  - `class CliContext`, a `Context.Service` with `{ cwd; env; username; color }`.
  - The global flags: `Json` (boolean) and `Dir` (`Option<string>`).
  - `taskId(text)`: `"07"` → `"7"`.
  - `listRoot: Effect<string, NoListFound | StoreError, …>`
  - `withTodo(f)` and `output(value, human)`.
  - `author(flag: Option<string>)`: the flag, then `$TODO_MD_AUTHOR`, then the user name.
  - The `init` and `fmt` commands.
  - `version`, the `todo` command, and `main(args, context): Effect<number, never, Command.Environment>`.
  - In tests: `runTodo(args, { cwd?, env?, color? }): Effect<{ code; stdout; stderr }, never, Disk>` and `todo(...args)`.

- [ ] **Step 1: Write the harness and the failing test**

Create `test/cli/harness.ts`:

```ts
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { TestConsole } from "effect/testing"
import { main } from "../../src/cli/main.ts"
import { Disk } from "../fs/helpers.ts"

export interface Result {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export interface RunOptions {
  /** Working directory, relative to the test directory (default: the test directory itself). */
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly color?: boolean
}

const text = (lines: ReadonlyArray<unknown>) => lines.map(String).join("\n")

/** Runs `todo <args>` from the test directory and captures what it printed. */
export const runTodo = (args: ReadonlyArray<string>, options: RunOptions = {}) =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const out = (yield* TestConsole.logLines).length
    const err = (yield* TestConsole.errorLines).length
    const code = yield* main(args, {
      cwd: options.cwd === undefined ? root : `${root}/${options.cwd}`,
      env: options.env ?? {},
      username: "tester",
      color: options.color ?? false,
    }).pipe(Effect.provide(BunServices.layer))
    return {
      code,
      stdout: text((yield* TestConsole.logLines).slice(out)),
      stderr: text((yield* TestConsole.errorLines).slice(err)),
    } satisfies Result
  })

export const todo = (...args: ReadonlyArray<string>) => runTodo(args)
```

Create `test/cli/lists.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "../fs/helpers.ts"
import { runTodo, todo } from "./harness.ts"

describe("todo init", () => {
  effectTest(
    "creates ./todo/TODO.md titled after the working directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* disk.write("acme/README.md", "")
      const result = yield* runTodo(["init"], { cwd: "acme" })
      expect(result).toEqual({ code: 0, stdout: "Created todo/TODO.md", stderr: "" })
      expect(yield* disk.read("acme/todo/TODO.md")).toBe(md("# acme"))
    }),
    diskWith({}),
  )

  effectTest(
    "takes a directory and a title, and prints JSON with --json",
    Effect.gen(function* () {
      const disk = yield* Disk
      const result = yield* todo("init", "docs/tasks", "--title", "Acme API", "--json")
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ root: `${disk.root}/docs/tasks` })
      expect(yield* disk.read("docs/tasks/TODO.md")).toBe(md("# Acme API"))
    }),
    diskWith({}),
  )

  effectTest(
    "refuses a directory that already has a list",
    Effect.gen(function* () {
      const result = yield* todo("init", ".")
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("error: ")
      expect(result.stderr).toContain("already has a TODO.md")
    }),
    diskWith({ "TODO.md": md("# T") }),
  )
})

describe("todo fmt", () => {
  effectTest(
    "normalizes the list and says what it did",
    Effect.gen(function* () {
      const first = yield* todo("fmt")
      expect(first).toEqual({
        code: 0,
        stdout: "Numbered 1 task, completed 1 checked task.",
        stderr: "",
      })
      expect((yield* todo("fmt")).stdout).toBe("Nothing to normalize.")
      expect(JSON.parse((yield* todo("fmt", "--json")).stdout)).toEqual({
        assigned: [],
        finished: [],
        swept: [],
      })
    }),
    diskWith({ "TODO.md": md("# T", "", "- [ ] Buy milk", "- [x] 01 - Done by hand") }),
  )
})

describe("finding the list, errors and exit codes", () => {
  effectTest(
    "finds the list from a subdirectory, and uses --dir when given",
    Effect.gen(function* () {
      expect((yield* runTodo(["fmt"], { cwd: "src/deep" })).code).toBe(0)
      expect((yield* runTodo(["fmt", "--dir", "../.."], { cwd: "src/deep" })).code).toBe(0)
    }),
    diskWith({ "TODO.md": md("# T"), "src/deep/file.ts": "" }),
  )

  effectTest(
    "fails with exit 1 and a message when there is no list",
    Effect.gen(function* () {
      const result = yield* todo("fmt")
      expect(result.code).toBe(1)
      expect(result.stdout).toBe("")
      expect(result.stderr).toMatch(
        /^error: no todo\.md list found from .*; run `todo init` or pass --dir$/,
      )
      const json = yield* todo("fmt", "--json")
      expect(json.code).toBe(1)
      expect(JSON.parse(json.stderr)).toMatchObject({ error: { tag: "NoListFound" } })
    }),
    diskWith({}),
  )

  effectTest(
    "fails with exit 2 on a usage error, and exits 0 for --help",
    Effect.gen(function* () {
      const unknown = yield* todo("frobnicate")
      expect(unknown.code).toBe(2)
      expect(unknown.stderr).toContain('Unknown subcommand "frobnicate"')
      const help = yield* todo("--help")
      expect(help.code).toBe(0)
      expect(help.stdout).toContain("USAGE")
    }),
    diskWith({}),
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/cli/lists.test.ts`
Expected: FAIL with `Cannot find module '../../src/cli/main.ts'`.

- [ ] **Step 3: Write the context**

Create `src/cli/context.ts`:

```ts
import { Console, Context, Effect, Option, Path } from "effect"
import { Flag, GlobalFlag } from "effect/unstable/cli"
import { TodoService } from "../core/index.ts"
import { FsTodoStore, findListRoot } from "../fs/index.ts"
import { NoListFound } from "./errors.ts"
import { type Style, styleFor } from "./style.ts"

/** Where the CLI runs. `bin.ts` fills it from the process; tests pass their own. */
export class CliContext extends Context.Service<
  CliContext,
  {
    readonly cwd: string
    readonly env: Readonly<Record<string, string | undefined>>
    /** The OS user name: the last fallback for a comment's author. */
    readonly username: string
    /** Whether to color human output. */
    readonly color: boolean
  }
>()("@lemol/todo-md/cli/CliContext") {}

export const Json = GlobalFlag.setting("json")({
  flag: Flag.boolean("json").pipe(
    Flag.withDescription("Print the result as JSON on stdout; failures go to stderr as JSON"),
  ),
})

export const Dir = GlobalFlag.setting("dir")({
  flag: Flag.string("dir").pipe(
    Flag.optional,
    Flag.withDescription(
      "The list's directory (the one holding TODO.md). Default: the nearest todo/TODO.md or TODO.md above the working directory",
    ),
  ),
})

/** A task ID as the store knows it: people may type `07` for task `7`. */
export const taskId = (text: string): string =>
  /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : text

/** The list root: `--dir`, else discovered from the working directory. */
export const listRoot = Effect.gen(function* () {
  const { cwd } = yield* CliContext
  const dir = yield* Dir
  const path = yield* Path.Path
  if (Option.isSome(dir)) return path.resolve(cwd, dir.value)
  const found = yield* findListRoot(cwd)
  if (Option.isNone(found)) return yield* new NoListFound({ cwd })
  return found.value
})

/** Runs `f` with a `TodoService` over the list's files. */
export const withTodo = <A, E>(f: (todo: TodoService["Service"]) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const root = yield* listRoot
    return yield* Effect.gen(function* () {
      return yield* f(yield* TodoService)
    }).pipe(Effect.provide(TodoService.layer), Effect.provide(FsTodoStore.layer({ root })))
  })

/** Prints a result: JSON under `--json`, the human lines otherwise. */
export const output = (value: unknown, human: (style: Style) => ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (yield* Json) return yield* Console.log(JSON.stringify(value))
    const { color } = yield* CliContext
    yield* Console.log(human(styleFor(color)).join("\n"))
  })

/** A comment's author: `--author`, else `$TODO_MD_AUTHOR`, else the OS user name. */
export const author = (flag: Option.Option<string>) =>
  Effect.map(CliContext, (context) =>
    Option.getOrElse(flag, () => context.env.TODO_MD_AUTHOR ?? context.username),
  )
```

- [ ] **Step 4: Write `init` and `fmt`**

Create `src/cli/commands/lists.ts`:

```ts
import { Effect, Option, Path } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { FsTodoStore, initList, type NormalizeReport } from "../../fs/index.ts"
import { CliContext, Dir, listRoot, output } from "../context.ts"

export const init = Command.make(
  "init",
  {
    dir: Argument.string("dir").pipe(
      Argument.optional,
      Argument.withDescription("Where to create the list (default: ./todo)"),
    ),
    title: Flag.string("title").pipe(
      Flag.optional,
      Flag.withDescription("The list's title (default: the working directory's name)"),
    ),
  },
  Effect.fn(function* ({ dir, title }) {
    const { cwd } = yield* CliContext
    const path = yield* Path.Path
    const fallback = Option.getOrElse(yield* Dir, () => "todo")
    const target = Option.getOrElse(dir, () => fallback)
    const root = path.resolve(cwd, target)
    yield* initList(root, { title: Option.getOrElse(title, () => path.basename(cwd)) })
    yield* output({ root }, () => [`Created ${path.join(path.relative(cwd, root), "TODO.md")}`])
  }),
).pipe(
  Command.withDescription("Create a todo.md list: a directory holding TODO.md"),
  Command.withExamples([
    { command: "todo init", description: "Create ./todo/TODO.md titled after this directory" },
    { command: 'todo init docs/tasks --title "Acme API"', description: "Create a list elsewhere" },
  ]),
)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

const summarize = (report: NormalizeReport): string => {
  const parts = [
    ...(report.assigned.length > 0 ? [`numbered ${plural(report.assigned.length, "task")}`] : []),
    ...(report.swept.length > 0
      ? [`completed ${plural(report.swept.length, "checked task")}`]
      : []),
    ...(report.finished.length > 0
      ? [`finished ${plural(report.finished.length, "interrupted completion")}`]
      : []),
  ]
  const text = parts.join(", ")
  return text === "" ? "Nothing to normalize." : `${text[0]?.toUpperCase()}${text.slice(1)}.`
}

export const fmt = Command.make(
  "fmt",
  {},
  Effect.fn(function* () {
    const report = yield* FsTodoStore.normalize(yield* listRoot)
    yield* output(report, () => [summarize(report)])
  }),
).pipe(
  Command.withDescription(
    "Normalize a hand-edited list: number new items, complete ticked ones, sync link text",
  ),
  Command.withExamples([
    { command: "todo fmt", description: "Tidy TODO.md after editing it by hand" },
  ]),
)
```

- [ ] **Step 5: Write `main`**

Create `src/cli/main.ts`:

```ts
import { Console, Effect } from "effect"
import { CliOutput, Command } from "effect/unstable/cli"
import { fmt, init } from "./commands/lists.ts"
import { CliContext, Dir, Json } from "./context.ts"
import { describeError, errorJson, exitCodeOf } from "./errors.ts"

/** Keep in step with package.json's version. */
export const version = "0.0.0"

export const todo = Command.make("todo").pipe(
  Command.withDescription("Manage a todo.md task list: plain Markdown for humans and agents"),
  Command.withSubcommands([init, fmt]),
  Command.withGlobalFlags([Json, Dir]),
)

/**
 * Runs the CLI on `args` and returns the exit code: 0 on success, 1 when an
 * operation fails (the reason is printed on stderr), 2 for a usage error.
 */
export const main = (
  args: ReadonlyArray<string>,
  context: CliContext["Service"],
): Effect.Effect<number, never, Command.Environment> =>
  Command.runWith(todo, { version })(args).pipe(
    Effect.as(0),
    Effect.catch((error) =>
      Effect.gen(function* () {
        // Usage errors were printed with the help; check already printed its problems.
        const tag: string = error._tag
        if (tag !== "ShowHelp" && tag !== "ProblemsFound") {
          yield* Console.error(
            args.includes("--json")
              ? JSON.stringify({ error: errorJson(error) })
              : `error: ${describeError(error)}`,
          )
        }
        return exitCodeOf(error)
      }),
    ),
    Effect.provideService(CliContext, context),
    Effect.provide(CliOutput.layer(CliOutput.defaultFormatter({ colors: context.color }))),
  )
```

Two details matter here:
- **Call `Command.withGlobalFlags` after `Command.withSubcommands`.** In the other order, TypeScript reports the `--json`/`--dir` settings as unmet requirements.
- **`CliOutput.defaultFormatter({ colors })`** keeps help text uncolored in tests and pipes.

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test test/cli/lists.test.ts`
Expected: `7 pass`, `0 fail`.

- [ ] **Step 7: Run the gate and commit**

```bash
bun run check
git add src/cli/context.ts src/cli/commands/lists.ts src/cli/main.ts test/cli/harness.ts test/cli/lists.test.ts
git commit -m "Add the todo command's entry point, init and fmt" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 3: Reading the list: `list`, `next`, `show`, `check`

**Files:**
- Create: `src/cli/commands/query.ts`
- Modify: `src/cli/main.ts`
- Test: `test/cli/fixtures.ts`, `test/cli/query.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 and `TaskFilter` from `core`.
- Produces:
  - The commands `list` (alias `ls`), `next`, `show` and `check`.
  - `showList(filter?)`, which a plain `todo` also runs.
  - In tests: `acme` (a sample list: ungrouped `01`, Backend `02` as a linked file with a comment, `03` depending on `02`, Frontend `04`, and done `05`) and `lines(...)`.

- [ ] **Step 1: Write the fixtures and the failing test**

Create `test/cli/fixtures.ts`:

```ts
import { md } from "../fs/helpers.ts"

/** A list with ungrouped and grouped tasks, a linked task file, a dependency and a done task. */
export const acme = {
  "TODO.md": md(
    "# Acme API",
    "",
    "- [ ] 01 - Write changelog",
    "",
    "## Backend",
    "",
    "- [ ] [02 - Add rate limiting](./backend/02-add-rate-limiting.md)",
    "- [ ] 03 - Fix login redirect",
    "  #bug @lemol depends_on:2",
    "  Users land on /home.",
    "",
    "## Frontend",
    "",
    "- [ ] 04 - Fix layout",
    "  @claude",
  ),
  "backend/02-add-rate-limiting.md": md(
    "---",
    "title: Add rate limiting",
    "tags: [api]",
    "---",
    "Token bucket per API key.",
    "",
    "## Comments",
    "",
    "### @lemol at 2026-09-12 12:00",
    "",
    "Started.",
  ),
  "done/05-set-up-ci.md": md(
    "---",
    "title: Set up CI",
    "completed_at: 2026-09-10T08:00:00Z",
    "---",
  ),
}

export const lines = (...text: string[]) => text.join("\n")
```

Create `test/cli/query.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { diskWith, md } from "../fs/helpers.ts"
import { acme, lines } from "./fixtures.ts"
import { runTodo, todo } from "./harness.ts"

describe("todo / todo list", () => {
  effectTest(
    "shows the outline of open tasks, what blocks them, and a summary",
    Effect.gen(function* () {
      const expected = lines(
        "Acme API",
        "",
        "  01  Write changelog",
        "",
        "Backend",
        "  02  Add rate limiting   #api",
        "  03  Fix login redirect  #bug @lemol",
        "      blocked by 02",
        "",
        "Frontend",
        "  04  Fix layout  @claude",
        "",
        "4 open · 3 ready · 1 blocked",
      )
      expect(yield* todo()).toEqual({ code: 0, stdout: expected, stderr: "" })
      expect((yield* todo("list")).stdout).toBe(expected)
      expect((yield* todo("ls")).stdout).toBe(expected)
    }),
    diskWith(acme),
  )

  effectTest(
    "filters by tag, assignee, group and state",
    Effect.gen(function* () {
      expect((yield* todo("ls", "--tag", "bug")).stdout).toBe(
        lines(
          "Acme API",
          "",
          "Backend",
          "  03  Fix login redirect  #bug @lemol",
          "      blocked by 02",
          "",
          "1 open · 0 ready · 1 blocked",
        ),
      )
      expect((yield* todo("ls", "--assignee", "claude")).stdout).toContain("04  Fix layout")
      expect((yield* todo("ls", "--group", "Frontend")).stdout).not.toContain("01")
      expect((yield* todo("ls", "--blocked")).stdout).toContain("1 open · 0 ready · 1 blocked")
      expect((yield* todo("ls", "--tag", "nope")).stdout).toBe(lines("Acme API", "", "No tasks."))
    }),
    diskWith(acme),
  )

  effectTest(
    "shows done tasks with --done and --all",
    Effect.gen(function* () {
      expect((yield* todo("list", "--done")).stdout).toBe(
        lines("Acme API", "", "Done", "  05  Set up CI  2026-09-10", "", "1 done"),
      )
      expect((yield* todo("list", "--all")).stdout).toContain(
        "4 open · 3 ready · 1 blocked · 1 done",
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "prints the listing as JSON",
    Effect.gen(function* () {
      const listing = JSON.parse((yield* todo("list", "--ready", "--json")).stdout)
      type Section = { name?: string; tasks: { task: { id: string }; state: string }[] }
      expect(listing.title).toBe("Acme API")
      expect(
        listing.sections.map((s: Section) => [
          s.name ?? null,
          s.tasks.map((v) => [v.task.id, v.state]),
        ]),
      ).toEqual([
        [null, [["1", "ready"]]],
        ["Backend", [["2", "ready"]]],
        ["Frontend", [["4", "ready"]]],
      ])
      expect(listing.done).toEqual([])
    }),
    diskWith(acme),
  )

  effectTest(
    "rejects --ready together with --blocked",
    Effect.gen(function* () {
      const result = yield* todo("list", "--ready", "--blocked")
      expect(result.code).toBe(2)
      expect(result.stderr).toBe("error: use --ready or --blocked, not both")
    }),
    diskWith(acme),
  )

  effectTest(
    "colors the output on a terminal",
    Effect.gen(function* () {
      const result = yield* runTodo([], { color: true })
      expect(result.stdout.startsWith("\u001b[1mAcme API\u001b[22m")).toBe(true)
      expect(result.stdout).toContain("\u001b[33mblocked by 02\u001b[39m")
    }),
    diskWith(acme),
  )
})

describe("todo next", () => {
  effectTest(
    "shows the most important ready task, or more with --limit",
    Effect.gen(function* () {
      expect((yield* todo("next")).stdout).toBe("  01  Write changelog")
      expect((yield* todo("next", "--limit", "0")).stdout).toBe(
        lines(
          "  01  Write changelog",
          "  02  Add rate limiting  #api",
          "  04  Fix layout         @claude",
        ),
      )
      expect((yield* todo("next", "--group", "Nope")).stdout).toBe("Nothing is ready.")
      const json = JSON.parse((yield* todo("next", "--assignee", "claude", "--json")).stdout)
      expect(json.map((v: { task: { id: string } }) => v.task.id)).toEqual(["4"])
    }),
    diskWith(acme),
  )
})

describe("todo show", () => {
  effectTest(
    "shows a task's state, description, dependencies and comments",
    Effect.gen(function* () {
      expect((yield* todo("show", "02")).stdout).toBe(
        lines(
          "02  Add rate limiting",
          "    ready · Backend · #api",
          "",
          "    Token bucket per API key.",
          "",
          "    Blocks",
          "      03  Fix login redirect  blocked",
          "",
          "    Comments",
          "      @lemol at 2026-09-12 12:00",
          "        Started.",
        ),
      )
      expect((yield* todo("show", "3")).stdout).toBe(
        lines(
          "03  Fix login redirect",
          "    blocked by 02 · Backend · #bug @lemol",
          "",
          "    Users land on /home.",
          "",
          "    Depends on",
          "      02  Add rate limiting  ready",
        ),
      )
      expect(JSON.parse((yield* todo("show", "3", "--json")).stdout).view.blockedBy).toEqual(["2"])
    }),
    diskWith(acme),
  )

  effectTest(
    "fails for an unknown task",
    Effect.gen(function* () {
      expect(yield* todo("show", "99")).toEqual({
        code: 1,
        stdout: "",
        stderr: "error: no task 99",
      })
      const json = yield* todo("show", "99", "--json")
      expect(JSON.parse(json.stderr)).toEqual({
        error: { tag: "TaskNotFound", message: "no task 99", id: "99" },
      })
    }),
    diskWith(acme),
  )
})

describe("todo check", () => {
  effectTest(
    "reports a clean list",
    Effect.gen(function* () {
      expect(yield* todo("check")).toEqual({ code: 0, stdout: "No problems found.", stderr: "" })
    }),
    diskWith(acme),
  )

  effectTest(
    "lists problems, errors first, and exits with 1 when there are errors",
    Effect.gen(function* () {
      expect(yield* todo("check")).toEqual({
        code: 1,
        stdout: lines(
          "error    TODO.md:1  broken-link  01-missing.md does not exist",
          "error    task 02  unknown-dependency  task 2 depends on unknown task 9",
          "",
          "2 errors",
        ),
        stderr: "",
      })
      const json = yield* todo("check", "--json")
      expect(json.code).toBe(1)
      expect(JSON.parse(json.stdout).map((d: { code: string }) => d.code)).toEqual([
        "broken-link",
        "unknown-dependency",
      ])
      expect(json.stderr).toBe("")
    }),
    diskWith({
      "TODO.md": md("- [ ] [01 - Missing](./01-missing.md)", "- [ ] 02 - Waits", "  depends_on:9"),
    }),
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/cli/query.test.ts`
Expected: `0 pass`, `11 fail`. `list` and the other commands don't exist yet, so each run exits 2 with `Unknown subcommand`.

- [ ] **Step 3: Write the commands**

Create `src/cli/commands/query.ts`:

```ts
import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import type { TaskFilter } from "../../core/index.ts"
import { output, taskId, withTodo } from "../context.ts"
import { ProblemsFound, UsageError } from "../errors.ts"
import { renderDetail, renderDiagnostics, renderListing, taskLines } from "../render.ts"

/** Filters shared by `list` and `next`. */
const filterFlags = {
  tag: Flag.string("tag").pipe(
    Flag.atLeast(0),
    Flag.withDescription("Only tasks with this tag; repeat to require several"),
  ),
  assignee: Flag.string("assignee").pipe(
    Flag.optional,
    Flag.withDescription("Only tasks assigned to this handle"),
  ),
  group: Flag.string("group").pipe(Flag.optional, Flag.withDescription("Only tasks in this group")),
}

const filterOf = (flags: {
  readonly tag: ReadonlyArray<string>
  readonly assignee: Option.Option<string>
  readonly group: Option.Option<string>
}): TaskFilter => ({
  ...(flags.tag.length > 0 ? { tags: flags.tag } : {}),
  ...(Option.isSome(flags.assignee) ? { assignee: flags.assignee.value } : {}),
  ...(Option.isSome(flags.group) ? { group: flags.group.value } : {}),
})

/** Prints the list; `todo` with no command does this too. */
export const showList = (filter: TaskFilter = {}) =>
  Effect.gen(function* () {
    const listing = yield* withTodo((todo) => todo.list(filter))
    yield* output(listing, (style) => renderListing(listing, style))
  })

export const list = Command.make(
  "list",
  {
    ...filterFlags,
    ready: Flag.boolean("ready").pipe(Flag.withDescription("Only tasks that are ready")),
    blocked: Flag.boolean("blocked").pipe(
      Flag.withDescription("Only tasks blocked by an unfinished dependency"),
    ),
    done: Flag.boolean("done").pipe(Flag.withDescription("Only done tasks, newest first")),
    all: Flag.boolean("all").pipe(Flag.withDescription("Open and done tasks")),
  },
  Effect.fn(function* (flags) {
    if (flags.ready && flags.blocked) {
      return yield* new UsageError({ message: "use --ready or --blocked, not both" })
    }
    const state = flags.ready ? "ready" : flags.blocked ? "blocked" : undefined
    const status = flags.all ? "all" : flags.done ? "done" : "open"
    yield* showList({ ...filterOf(flags), status, ...(state === undefined ? {} : { state }) })
  }),
).pipe(
  Command.withAlias("ls"),
  Command.withDescription("Show open tasks by group, with what blocks them"),
  Command.withExamples([
    { command: "todo list", description: "Everything open (same as plain `todo`)" },
    { command: "todo ls --tag bug --ready", description: "Ready tasks tagged #bug" },
    { command: "todo list --done", description: "Completed tasks, newest first" },
    { command: "todo list --json", description: "The whole listing as JSON" },
  ]),
)

export const next = Command.make(
  "next",
  {
    ...filterFlags,
    limit: Flag.integer("limit").pipe(
      Flag.withDefault(1),
      Flag.withDescription("How many ready tasks to show (0 for all)"),
    ),
  },
  Effect.fn(function* (flags) {
    const ready = yield* withTodo((todo) => todo.next(filterOf(flags)))
    const shown = flags.limit > 0 ? ready.slice(0, flags.limit) : ready
    yield* output(shown, (style) =>
      shown.length === 0 ? ["Nothing is ready."] : taskLines(shown, style),
    )
  }),
).pipe(
  Command.withDescription("Show the ready task(s) to work on next, in priority order"),
  Command.withExamples([
    { command: "todo next", description: "The single most important ready task" },
    {
      command: "todo next --assignee claude --limit 3 --json",
      description: "An agent's next three",
    },
  ]),
)

export const show = Command.make(
  "show",
  { id: Argument.string("id").pipe(Argument.withDescription("The task's ID, e.g. 7 or 07")) },
  Effect.fn(function* ({ id }) {
    const detail = yield* withTodo((todo) => todo.show(taskId(id)))
    yield* output(detail, (style) => renderDetail(detail, style))
  }),
).pipe(
  Command.withDescription(
    "Show a task: state, description, dependencies, blocked tasks and comments",
  ),
  Command.withExamples([
    { command: "todo show 7", description: "Everything about task 07" },
    { command: "todo show 7 --json", description: "The same, as JSON" },
  ]),
)

export const check = Command.make(
  "check",
  {},
  Effect.fn(function* () {
    const diagnostics = yield* withTodo((todo) => todo.check())
    yield* output(diagnostics, (style) => renderDiagnostics(diagnostics, style))
    const errors = diagnostics.filter((d) => d.severity === "error").length
    if (errors > 0) return yield* new ProblemsFound({ errors })
  }),
).pipe(
  Command.withDescription("Validate the list; exits with 1 when it finds errors"),
  Command.withExamples([
    {
      command: "todo check",
      description: "List problems such as broken links or dependency cycles",
    },
    { command: "todo check --json", description: "The diagnostics as JSON" },
  ]),
)
```

- [ ] **Step 4: Register them**

Replace `src/cli/main.ts` with the following. It gives `todo` its default handler (`showList`) and adds the four commands:

```ts
import { Console, Effect } from "effect"
import { CliOutput, Command } from "effect/unstable/cli"
import { fmt, init } from "./commands/lists.ts"
import { check, list, next, show, showList } from "./commands/query.ts"
import { CliContext, Dir, Json } from "./context.ts"
import { describeError, errorJson, exitCodeOf } from "./errors.ts"

/** Keep in step with package.json's version. */
export const version = "0.0.0"

export const todo = Command.make("todo", {}, () => showList()).pipe(
  Command.withDescription("Manage a todo.md task list: plain Markdown for humans and agents"),
  Command.withSubcommands([list, next, show, check, init, fmt]),
  Command.withGlobalFlags([Json, Dir]),
)

/**
 * Runs the CLI on `args` and returns the exit code: 0 on success, 1 when an
 * operation fails (the reason is printed on stderr), 2 for a usage error.
 */
export const main = (
  args: ReadonlyArray<string>,
  context: CliContext["Service"],
): Effect.Effect<number, never, Command.Environment> =>
  Command.runWith(todo, { version })(args).pipe(
    Effect.as(0),
    Effect.catch((error) =>
      Effect.gen(function* () {
        // Usage errors were printed with the help; check already printed its problems.
        const tag: string = error._tag
        if (tag !== "ShowHelp" && tag !== "ProblemsFound") {
          yield* Console.error(
            args.includes("--json")
              ? JSON.stringify({ error: errorJson(error) })
              : `error: ${describeError(error)}`,
          )
        }
        return exitCodeOf(error)
      }),
    ),
    Effect.provideService(CliContext, context),
    Effect.provide(CliOutput.layer(CliOutput.defaultFormatter({ colors: context.color }))),
  )
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test test/cli/query.test.ts`
Expected: `11 pass`, `0 fail`.

- [ ] **Step 6: Run the gate and commit**

```bash
bun run check
git add src/cli/commands/query.ts src/cli/main.ts test/cli/fixtures.ts test/cli/query.test.ts
git commit -m "Show, filter and check the list from the todo command" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 4: Changing tasks: `add`, `edit`, `done`, `reopen`, `mv`, `rm`, `comment`

**Files:**
- Create: `src/cli/commands/tasks.ts`
- Modify: `src/cli/main.ts`
- Test: `test/cli/tasks.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `Placement`, `TaskPatch` and `unique` from `spec`.
- Produces: the commands `add`, `edit`, `done`, `reopen`, `mv`, `rm` and `comment`.

- [ ] **Step 1: Write the failing test**

Create `test/cli/tasks.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "../fs/helpers.ts"
import { acme, lines } from "./fixtures.ts"
import { runTodo, todo } from "./harness.ts"

const showJson = (id: string) =>
  Effect.map(todo("show", id, "--json"), (result) => JSON.parse(result.stdout).view.task)

describe("todo add", () => {
  effectTest(
    "adds a task with the next free ID, joining unquoted words",
    Effect.gen(function* () {
      const result = yield* todo("add", "Ship", "it", "--group", "Backend", "--tag", "release")
      expect(result).toEqual({ code: 0, stdout: "Added 06  Ship it to Backend", stderr: "" })
      expect(yield* (yield* Disk).read("TODO.md")).toContain("- [ ] 06 - Ship it\n  #release\n")
    }),
    diskWith(acme),
  )

  effectTest(
    "accepts padded IDs for dependencies and anchors, and prints JSON",
    Effect.gen(function* () {
      const result = yield* todo(
        "add",
        "Load test",
        "--depends-on",
        "02",
        "--before",
        "03",
        "--json",
      )
      expect(JSON.parse(result.stdout)).toMatchObject({
        id: "6",
        title: "Load test",
        dependsOn: ["2"],
        group: "Backend",
      })
      expect((yield* todo("ls", "--group", "Backend")).stdout).toContain(
        lines("  02  Add rate limiting   #api", "  06  Load test"),
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "fails for an unknown anchor",
    Effect.gen(function* () {
      expect(yield* todo("add", "X", "--after", "99")).toEqual({
        code: 1,
        stdout: "",
        stderr: "error: no task 99",
      })
    }),
    diskWith(acme),
  )
})

describe("todo edit", () => {
  effectTest(
    "changes the title, tags, assignee and dependencies",
    Effect.gen(function* () {
      const result = yield* todo(
        "edit",
        "03",
        "--title",
        "Fix the redirect",
        "--tag",
        "urgent",
        "--untag",
        "bug",
        "--unassign",
        "--drop-dependency",
        "2",
      )
      expect(result.stdout).toBe("Updated 03  Fix the redirect")
      expect(yield* showJson("3")).toMatchObject({
        title: "Fix the redirect",
        tags: ["urgent"],
        dependsOn: [],
      })
      expect((yield* showJson("3")).assignee).toBeUndefined()
    }),
    diskWith(acme),
  )

  effectTest(
    "refuses an empty or contradictory edit with a usage error",
    Effect.gen(function* () {
      const empty = yield* todo("edit", "3")
      expect(empty.code).toBe(2)
      expect(empty.stderr).toBe(
        "error: nothing to change; pass --title, --tag, --assignee or another change",
      )
      expect((yield* todo("edit", "3", "--assignee", "a", "--unassign")).code).toBe(2)
    }),
    diskWith(acme),
  )
})

describe("todo done and reopen", () => {
  effectTest(
    "completes tasks and lists the ones that became ready",
    Effect.gen(function* () {
      expect((yield* todo("done", "2")).stdout).toBe(
        lines("Done 02  Add rate limiting", "Now ready:", "  03  Fix login redirect  #bug @lemol"),
      )
      expect(yield* (yield* Disk).exists("done/backend/02-add-rate-limiting.md")).toBe(true)
      const both = JSON.parse((yield* todo("done", "1", "4", "--json")).stdout)
      expect(both.map((c: { task: { id: string } }) => c.task.id)).toEqual(["1", "4"])
    }),
    diskWith(acme),
  )

  effectTest(
    "explains why a task cannot be completed or reopened",
    Effect.gen(function* () {
      expect((yield* todo("done", "99")).stderr).toBe("error: no task 99")
      yield* todo("done", "2")
      expect((yield* todo("done", "2")).stderr).toBe(
        "error: task 2 is done, so it cannot be completed",
      )
      expect((yield* todo("reopen", "2")).stdout).toBe("Reopened 02  Add rate limiting")
      expect((yield* todo("reopen", "2")).stderr).toBe(
        "error: task 2 is open, so it cannot be reopened",
      )
    }),
    diskWith(acme),
  )
})

describe("todo mv", () => {
  effectTest(
    "moves a task to the top, to another group, or out of its group",
    Effect.gen(function* () {
      expect((yield* todo("mv", "3", "--top")).stdout).toBe(
        "Moved 03  Fix login redirect to Backend",
      )
      expect((yield* todo("ls", "--group", "Backend")).stdout).toContain(
        lines(
          "  03  Fix login redirect  #bug @lemol",
          "      blocked by 02",
          "  02  Add rate limiting   #api",
        ),
      )
      expect((yield* todo("mv", "1", "--group", "Frontend")).stdout).toBe(
        "Moved 01  Write changelog to Frontend",
      )
      expect((yield* todo("mv", "4", "--ungrouped")).stdout).toBe(
        "Moved 04  Fix layout to the ungrouped tasks",
      )
      expect((yield* todo("mv", "3", "--bottom")).code).toBe(0)
      expect((yield* todo("mv", "2", "--after", "3", "--json")).code).toBe(0)
    }),
    diskWith(acme),
  )

  effectTest(
    "needs exactly one destination",
    Effect.gen(function* () {
      const none = yield* todo("mv", "3")
      expect(none.code).toBe(2)
      expect(none.stderr).toContain("say where to move it")
      expect((yield* todo("mv", "3", "--top", "--bottom")).code).toBe(2)
    }),
    diskWith(acme),
  )
})

describe("todo rm", () => {
  effectTest(
    "refuses to remove a task others depend on unless forced",
    Effect.gen(function* () {
      expect(yield* todo("rm", "2")).toEqual({
        code: 1,
        stdout: "",
        stderr: "error: task 2 is needed by 3; use --force to remove it anyway",
      })
      expect((yield* todo("rm", "2", "--force")).stdout).toBe("Removed 02")
      expect(yield* (yield* Disk).exists("backend/02-add-rate-limiting.md")).toBe(false)
      expect(JSON.parse((yield* todo("rm", "1", "--json")).stdout)).toEqual({ removed: "1" })
    }),
    diskWith(acme),
  )
})

describe("todo comment", () => {
  effectTest(
    "adds a comment, moving an inline task into its own file",
    Effect.gen(function* () {
      const result = yield* todo("comment", "1", "Draft", "it", "--author", "claude")
      expect(result).toEqual({ code: 0, stdout: "Commented on 01", stderr: "" })
      expect(yield* (yield* Disk).read("01-write-changelog.md")).toBe(
        md(
          "---",
          "title: Write changelog",
          "---",
          "## Comments",
          "",
          "### @claude at 1970-01-01 00:00 +00:00",
          "",
          "Draft it",
        ),
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "takes the author from $TODO_MD_AUTHOR, then the user name",
    Effect.gen(function* () {
      yield* runTodo(["comment", "2", "From", "env"], { env: { TODO_MD_AUTHOR: "agent-7" } })
      yield* todo("comment", "2", "From", "user")
      const comments = (yield* showJson("2")).comments.map((c: { author: string }) => c.author)
      expect(comments).toEqual(["tester", "agent-7", "lemol"])
    }),
    diskWith(acme),
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/cli/tasks.test.ts`
Expected: `0 pass`, `12 fail` (`Unknown subcommand "add"` and so on).

- [ ] **Step 3: Write the commands**

Create `src/cli/commands/tasks.ts`:

```ts
import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { type Placement, type TaskPatch, unique } from "../../spec/index.ts"
import { author, output, taskId, withTodo } from "../context.ts"
import { UsageError } from "../errors.ts"
import { label, renderCompletions, showId } from "../render.ts"

const idArgument = Argument.string("id").pipe(
  Argument.withDescription("The task's ID, e.g. 7 or 07"),
)

/** Words of a variadic argument joined with spaces, so quotes are optional: `todo add Fix the bug`. */
const words = (name: string, description: string) =>
  Argument.string(name).pipe(Argument.variadic({ min: 1 }), Argument.withDescription(description))

const repeated = (name: string, description: string) =>
  Flag.string(name).pipe(Flag.atLeast(0), Flag.withDescription(description))

const optional = (name: string, description: string) =>
  Flag.string(name).pipe(Flag.optional, Flag.withDescription(description))

const some = <A>(key: string, value: Option.Option<A>) =>
  Option.isSome(value) ? { [key]: value.value } : {}

export const add = Command.make(
  "add",
  {
    title: words("title", "The task's title"),
    group: optional("group", "Add to this group (created if missing); default: ungrouped"),
    tag: repeated("tag", "A tag; repeat for several"),
    assignee: optional("assignee", "Who works on it (a handle)"),
    dependsOn: repeated("depends-on", "A task that must be done first; repeat for several"),
    description: optional("description", "A longer description (Markdown)"),
    before: optional("before", "Place it before this task"),
    after: optional("after", "Place it after this task"),
  },
  Effect.fn(function* (flags) {
    const task = yield* withTodo((todo) =>
      todo.add(
        {
          title: flags.title.join(" "),
          ...(flags.tag.length > 0 ? { tags: flags.tag } : {}),
          ...(flags.dependsOn.length > 0 ? { dependsOn: flags.dependsOn.map(taskId) } : {}),
          ...some("assignee", flags.assignee),
          ...some("description", flags.description),
        },
        {
          ...some("group", flags.group),
          ...some("before", Option.map(flags.before, taskId)),
          ...some("after", Option.map(flags.after, taskId)),
        },
      ),
    )
    yield* output(task, () => [
      `Added ${label(task)}${task.group === undefined ? "" : ` to ${task.group}`}`,
    ])
  }),
).pipe(
  Command.withDescription("Add a task"),
  Command.withExamples([
    { command: "todo add Write the changelog", description: "An ungrouped task (quotes optional)" },
    {
      command: 'todo add "Fix login redirect" --group Backend --tag bug --depends-on 2',
      description: "A tagged task in a group, waiting for task 02",
    },
    { command: "todo add Ship it --json", description: "Print the new task as JSON" },
  ]),
)

export const edit = Command.make(
  "edit",
  {
    id: idArgument,
    title: optional("title", "A new title"),
    description: optional("description", "A new description (Markdown)"),
    tag: repeated("tag", "Add a tag; repeat for several"),
    untag: repeated("untag", "Remove a tag; repeat for several"),
    assignee: optional("assignee", "Assign it to this handle"),
    unassign: Flag.boolean("unassign").pipe(Flag.withDescription("Remove the assignee")),
    dependsOn: repeated("depends-on", "Add a dependency; repeat for several"),
    dropDependency: repeated("drop-dependency", "Remove a dependency; repeat for several"),
  },
  Effect.fn(function* (flags) {
    if (flags.unassign && Option.isSome(flags.assignee)) {
      return yield* new UsageError({ message: "use --assignee or --unassign, not both" })
    }
    const id = taskId(flags.id)
    const task = yield* withTodo((todo) =>
      Effect.gen(function* () {
        const current = (yield* todo.show(id)).view.task
        const drop = new Set(flags.dropDependency.map(taskId))
        const patch: TaskPatch = {
          ...some("title", flags.title),
          ...some("description", flags.description),
          ...(flags.tag.length > 0 || flags.untag.length > 0
            ? {
                tags: unique([
                  ...current.tags.filter((t) => !flags.untag.includes(t)),
                  ...flags.tag,
                ]),
              }
            : {}),
          ...(flags.unassign ? { assignee: null } : some("assignee", flags.assignee)),
          ...(flags.dependsOn.length > 0 || drop.size > 0
            ? {
                dependsOn: unique([
                  ...current.dependsOn.filter((d) => !drop.has(d)),
                  ...flags.dependsOn.map(taskId),
                ]),
              }
            : {}),
        }
        if (Object.keys(patch).length === 0) {
          return yield* new UsageError({
            message: "nothing to change; pass --title, --tag, --assignee or another change",
          })
        }
        return yield* todo.update(id, patch)
      }),
    )
    yield* output(task, () => [`Updated ${label(task)}`])
  }),
).pipe(
  Command.withDescription("Change a task's title, description, tags, assignee or dependencies"),
  Command.withExamples([
    { command: 'todo edit 3 --title "Fix the login redirect"', description: "Rename task 03" },
    {
      command: "todo edit 3 --tag urgent --untag later --assignee claude",
      description: "Retag and assign it",
    },
    {
      command: "todo edit 3 --depends-on 7 --drop-dependency 2",
      description: "Change what it waits for",
    },
  ]),
)

export const done = Command.make(
  "done",
  {
    ids: Argument.string("id").pipe(
      Argument.variadic({ min: 1 }),
      Argument.withDescription("The tasks to complete"),
    ),
  },
  Effect.fn(function* ({ ids }) {
    const completions = yield* withTodo((todo) =>
      Effect.forEach(ids, (id) => todo.complete(taskId(id))),
    )
    yield* output(completions, (style) => renderCompletions(completions, style))
  }),
).pipe(
  Command.withDescription(
    "Complete tasks; their files move to done/ and newly ready tasks are listed",
  ),
  Command.withExamples([
    { command: "todo done 2", description: "Complete task 02" },
    {
      command: "todo done 2 3 --json",
      description: "Complete two tasks; print what they unblocked",
    },
  ]),
)

export const reopen = Command.make(
  "reopen",
  { id: idArgument },
  Effect.fn(function* ({ id }) {
    const task = yield* withTodo((todo) => todo.reopen(taskId(id)))
    yield* output(task, () => [`Reopened ${label(task)}`])
  }),
).pipe(
  Command.withDescription("Reopen a done task at the end of its group"),
  Command.withExamples([{ command: "todo reopen 2", description: "Put task 02 back on the list" }]),
)

export const mv = Command.make(
  "mv",
  {
    id: idArgument,
    group: optional("group", "Move to the end of this group (created if missing)"),
    ungrouped: Flag.boolean("ungrouped").pipe(
      Flag.withDescription("Move to the end of the ungrouped tasks"),
    ),
    before: optional("before", "Move right before this task"),
    after: optional("after", "Move right after this task"),
    top: Flag.boolean("top").pipe(Flag.withDescription("Move to the top of its group")),
    bottom: Flag.boolean("bottom").pipe(Flag.withDescription("Move to the bottom of its group")),
  },
  Effect.fn(function* (flags) {
    const chosen = [
      Option.isSome(flags.group),
      flags.ungrouped,
      Option.isSome(flags.before),
      Option.isSome(flags.after),
      flags.top,
      flags.bottom,
    ].filter(Boolean).length
    if (chosen !== 1) {
      return yield* new UsageError({
        message:
          "say where to move it with one of --group, --ungrouped, --before, --after, --top, --bottom",
      })
    }
    const id = taskId(flags.id)
    const task = yield* withTodo((todo) =>
      Effect.gen(function* () {
        const current = (yield* todo.show(id)).view.task
        if (flags.top) {
          const listing = yield* todo.list()
          const section = listing.sections.find((s) => s.tasks.some((v) => v.task.id === id))
          const first = section?.tasks[0]?.task
          if (first === undefined || first.id === id) return current
          return yield* todo.move(id, { before: first.id })
        }
        const placement: Placement = flags.bottom
          ? current.group === undefined
            ? {}
            : { group: current.group }
          : {
              ...some("group", flags.group),
              ...some("before", Option.map(flags.before, taskId)),
              ...some("after", Option.map(flags.after, taskId)),
            }
        return yield* todo.move(id, placement)
      }),
    )
    yield* output(task, () => [`Moved ${label(task)} to ${task.group ?? "the ungrouped tasks"}`])
  }),
).pipe(
  Command.withDescription("Reorder a task or move it to another group"),
  Command.withExamples([
    { command: "todo mv 3 --top", description: "Make task 03 the first of its group" },
    { command: "todo mv 3 --before 7", description: "Put it right before task 07" },
    { command: "todo mv 3 --group Frontend", description: "Move it to the end of Frontend" },
  ]),
)

export const rm = Command.make(
  "rm",
  {
    id: idArgument,
    force: Flag.boolean("force").pipe(
      Flag.withDescription("Remove it even if open tasks depend on it"),
    ),
  },
  Effect.fn(function* ({ id, force }) {
    const removed = taskId(id)
    yield* withTodo((todo) => todo.remove(removed, { force }))
    yield* output({ removed }, () => [`Removed ${showId(removed)}`])
  }),
).pipe(
  Command.withDescription(
    "Delete a task and its file for good (version control keeps the history)",
  ),
  Command.withExamples([
    { command: "todo rm 3", description: "Delete task 03" },
    { command: "todo rm 3 --force", description: "Delete it even though other tasks depend on it" },
  ]),
)

export const comment = Command.make(
  "comment",
  {
    id: idArgument,
    text: words("text", "The comment (Markdown; quotes optional)"),
    author: optional("author", "Who is commenting (default: $TODO_MD_AUTHOR, then your user name)"),
  },
  Effect.fn(function* (flags) {
    const id = taskId(flags.id)
    const by = yield* author(flags.author)
    const added = yield* withTodo((todo) =>
      todo.comment(id, { author: by, body: flags.text.join(" ") }),
    )
    yield* output(added, () => [`Commented on ${showId(id)}`])
  }),
).pipe(
  Command.withDescription("Add a comment to a task (it moves into its own file if it was inline)"),
  Command.withExamples([
    {
      command: 'todo comment 3 "Found the cause: the referrer is dropped."',
      description: "Comment as yourself",
    },
    { command: "todo comment 3 Started --author claude", description: "Comment as an agent" },
  ]),
)
```

- [ ] **Step 4: Register them**

Replace `src/cli/main.ts` with:

```ts
import { Console, Effect } from "effect"
import { CliOutput, Command } from "effect/unstable/cli"
import { fmt, init } from "./commands/lists.ts"
import { check, list, next, show, showList } from "./commands/query.ts"
import { add, comment, done, edit, mv, reopen, rm } from "./commands/tasks.ts"
import { CliContext, Dir, Json } from "./context.ts"
import { describeError, errorJson, exitCodeOf } from "./errors.ts"

/** Keep in step with package.json's version. */
export const version = "0.0.0"

export const todo = Command.make("todo", {}, () => showList()).pipe(
  Command.withDescription("Manage a todo.md task list: plain Markdown for humans and agents"),
  Command.withSubcommands([
    list,
    next,
    show,
    add,
    edit,
    done,
    reopen,
    mv,
    rm,
    comment,
    check,
    init,
    fmt,
  ]),
  Command.withGlobalFlags([Json, Dir]),
)

/**
 * Runs the CLI on `args` and returns the exit code: 0 on success, 1 when an
 * operation fails (the reason is printed on stderr), 2 for a usage error.
 */
export const main = (
  args: ReadonlyArray<string>,
  context: CliContext["Service"],
): Effect.Effect<number, never, Command.Environment> =>
  Command.runWith(todo, { version })(args).pipe(
    Effect.as(0),
    Effect.catch((error) =>
      Effect.gen(function* () {
        // Usage errors were printed with the help; check already printed its problems.
        const tag: string = error._tag
        if (tag !== "ShowHelp" && tag !== "ProblemsFound") {
          yield* Console.error(
            args.includes("--json")
              ? JSON.stringify({ error: errorJson(error) })
              : `error: ${describeError(error)}`,
          )
        }
        return exitCodeOf(error)
      }),
    ),
    Effect.provideService(CliContext, context),
    Effect.provide(CliOutput.layer(CliOutput.defaultFormatter({ colors: context.color }))),
  )
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test test/cli/tasks.test.ts`
Expected: `12 pass`, `0 fail`.

- [ ] **Step 6: Run the gate and commit**

```bash
bun run check
git add src/cli/commands/tasks.ts src/cli/main.ts test/cli/tasks.test.ts
git commit -m "Add, edit, complete, move, remove and comment on tasks from the todo command" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 5: The executable, help coverage and docs

**Files:**
- Create: `src/cli/bin.ts` (executable)
- Modify: `src/cli/main.ts` (root examples), `src/cli/index.ts` (replaces the placeholder), `package.json` (`bin`)
- Modify: `src/cli/README.md`, `docs/architecture.md`, `README.md`, `AGENTS.md`
- Test: `test/cli/help.test.ts`, `test/cli/bin.test.ts`, `test/cli/index.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - The `todo` executable.
  - `@lemol/todo-md/cli`, exporting `main`, `todo`, `version` and `CliContext`.

- [ ] **Step 1: Write the failing tests**

Create `test/cli/help.test.ts`:

```ts
import { expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { diskWith } from "../fs/helpers.ts"
import { todo } from "./harness.ts"

/** The lines of a help section: after its heading, up to a blank line or the next heading. */
const section = (help: string, heading: string): string[] => {
  const lines = help.split("\n")
  const start = lines.indexOf(heading)
  if (start === -1) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line === "" || /^[A-Z][A-Z ]+$/.test(line))
  return end === -1 ? rest : rest.slice(0, end)
}

/** A flag or argument line with a description: the name, two or more spaces, then text. */
const described = /^ {2}\S.*?\S {2,}\S/

effectTest(
  "every command has --help with a description, examples and a description for each flag",
  Effect.gen(function* () {
    const root = yield* todo("--help")
    expect(root.code).toBe(0)
    expect(section(root.stdout, "EXAMPLES").length).toBeGreaterThan(0)
    const commands = section(root.stdout, "SUBCOMMANDS").map(
      (line) => line.trim().split(/[\s,]+/)[0] ?? "",
    )
    expect(commands).toEqual([
      "list",
      "next",
      "show",
      "add",
      "edit",
      "done",
      "reopen",
      "mv",
      "rm",
      "comment",
      "check",
      "init",
      "fmt",
    ])
    for (const command of commands) {
      const help = yield* todo(command, "--help")
      expect(help.code, command).toBe(0)
      expect(section(help.stdout, "DESCRIPTION").length, command).toBeGreaterThan(0)
      expect(section(help.stdout, "EXAMPLES").length, command).toBeGreaterThan(0)
      for (const line of [...section(help.stdout, "FLAGS"), ...section(help.stdout, "ARGUMENTS")]) {
        expect(line, `${command}: ${line}`).toMatch(described)
      }
    }
  }),
  diskWith({}),
)

effectTest(
  "-h is --help, and help works without a list",
  Effect.gen(function* () {
    const help = yield* todo("add", "-h")
    expect(help.code).toBe(0)
    expect(help.stdout).toContain("todo add [flags] <title...>")
  }),
  diskWith({}),
)
```

Create `test/cli/bin.test.ts`:

```ts
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The real executable, as a separate process: exit codes and output streams.
const bin = join(import.meta.dir, "../../src/cli/bin.ts")
const dir = mkdtempSync(join(tmpdir(), "todo-md-bin-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const run = (...args: string[]) => {
  const result = Bun.spawnSync(["bun", bin, ...args], {
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1" },
  })
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe("the todo executable", () => {
  test("runs commands, exiting 0 on success, 1 on failure and 2 on usage errors", () => {
    expect(run("init", "--title", "Smoke")).toMatchObject({
      code: 0,
      stdout: "Created todo/TODO.md\n",
    })
    expect(run("add", "Try", "it")).toMatchObject({ code: 0, stdout: "Added 01  Try it\n" })
    expect(run("next", "--json").stdout).toContain('"title":"Try it"')
    expect(run("done", "9")).toMatchObject({ code: 1, stdout: "", stderr: "error: no task 9\n" })
    expect(run("mv", "1").code).toBe(2)
    expect(run("--version").stdout).toContain("0.0.0")
  })
})
```

Create `test/cli/index.test.ts`:

```ts
import { expect, test } from "bun:test"
import packageJson from "../../package.json"
import * as cli from "../../src/cli/index.ts"

test("the entry point exposes main, the command tree and the version", () => {
  expect(typeof cli.main).toBe("function")
  expect(cli.todo.name).toBe("todo")
  expect(cli.CliContext.key).toBe("@lemol/todo-md/cli/CliContext")
})

test("the CLI's version is package.json's version", () => {
  expect(cli.version).toBe(packageJson.version)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/cli/help.test.ts test/cli/bin.test.ts test/cli/index.test.ts`
Expected: `1 pass`, `4 fail`.
- The help test fails because `todo --help` has no `EXAMPLES` yet.
- The executable test fails because `bin.ts` doesn't exist.
- The entry-point tests fail because `src/cli/index.ts` is empty.
- `-h is --help` already passes.

- [ ] **Step 3: Add the root examples**

Replace `src/cli/main.ts` with the following, which adds `Command.withExamples` to `todo`:

```ts
import { Console, Effect } from "effect"
import { CliOutput, Command } from "effect/unstable/cli"
import { fmt, init } from "./commands/lists.ts"
import { check, list, next, show, showList } from "./commands/query.ts"
import { add, comment, done, edit, mv, reopen, rm } from "./commands/tasks.ts"
import { CliContext, Dir, Json } from "./context.ts"
import { describeError, errorJson, exitCodeOf } from "./errors.ts"

/** Keep in step with package.json's version. */
export const version = "0.0.0"

export const todo = Command.make("todo", {}, () => showList()).pipe(
  Command.withDescription("Manage a todo.md task list: plain Markdown for humans and agents"),
  Command.withExamples([
    { command: "todo", description: "Show the open tasks (same as `todo list`)" },
    { command: "todo add Fix the login redirect --group Backend", description: "Add a task" },
    { command: "todo next --json", description: "What to work on next, as JSON" },
    { command: "todo done 3", description: "Complete task 03" },
    { command: "todo <command> --help", description: "Help for any command" },
  ]),
  Command.withSubcommands([
    list,
    next,
    show,
    add,
    edit,
    done,
    reopen,
    mv,
    rm,
    comment,
    check,
    init,
    fmt,
  ]),
  Command.withGlobalFlags([Json, Dir]),
)

/**
 * Runs the CLI on `args` and returns the exit code: 0 on success, 1 when an
 * operation fails (the reason is printed on stderr), 2 for a usage error.
 */
export const main = (
  args: ReadonlyArray<string>,
  context: CliContext["Service"],
): Effect.Effect<number, never, Command.Environment> =>
  Command.runWith(todo, { version })(args).pipe(
    Effect.as(0),
    Effect.catch((error) =>
      Effect.gen(function* () {
        // Usage errors were printed with the help; check already printed its problems.
        const tag: string = error._tag
        if (tag !== "ShowHelp" && tag !== "ProblemsFound") {
          yield* Console.error(
            args.includes("--json")
              ? JSON.stringify({ error: errorJson(error) })
              : `error: ${describeError(error)}`,
          )
        }
        return exitCodeOf(error)
      }),
    ),
    Effect.provideService(CliContext, context),
    Effect.provide(CliOutput.layer(CliOutput.defaultFormatter({ colors: context.color }))),
  )
```

Effect's help formatter prints no blank line between `SUBCOMMANDS` and `EXAMPLES`. That's why the help test's `section` helper stops at the next all-caps heading as well as at a blank line.

- [ ] **Step 4: Write the executable and the entry point**

Create `src/cli/bin.ts`:

```ts
#!/usr/bin/env bun
import { userInfo } from "node:os"
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { main } from "./main.ts"

main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  username: userInfo().username,
  color: process.stdout.isTTY === true && process.env.NO_COLOR === undefined,
}).pipe(
  Effect.tap((code) =>
    Effect.sync(() => {
      process.exitCode = code
    }),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
)
```

Make it executable, so installs link it as a command:

```bash
chmod +x src/cli/bin.ts
```

`BunRuntime.runMain` calls `process.exit` only on failure or a signal, so setting `process.exitCode` from `main`'s result is what reaches the shell.

Replace the contents of `src/cli/index.ts` with:

```ts
export { CliContext } from "./context.ts"
export { main, todo, version } from "./main.ts"
```

In `package.json`, add this block right after `exports`:

```json
  "bin": {
    "todo": "./src/cli/bin.ts"
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test test/cli`
Expected: `57 pass`, `0 fail`.

Also run `./src/cli/bin.ts --help` once by hand. It should print the command list and the examples.

- [ ] **Step 6: Update the docs**

Replace `src/cli/README.md` with:

```markdown
# @lemol/todo-md/cli

The `todo` command: manage a todo.md list from a terminal or from an agent.
Built with `effect/unstable/cli` on `@effect/platform-bun`.

> Status: implemented for spec 0.1.

## Install

- **As a dependency:** `@lemol/todo-md` declares `bin: { todo: ./src/cli/bin.ts }`,
  so `todo` is on the path in `node_modules/.bin` (for example `bunx todo`).
- **From a checkout:** `bun link` in this repository makes `todo` available
  globally.
- **Without installing:** `bun src/cli/bin.ts <command>`.

Every command has `--help` (or `-h`) with a description, every flag, and
examples. `todo --help` lists the commands.

## Commands

| Command | Does | JSON result |
| --- | --- | --- |
| `todo` | Same as `todo list` | listing |
| `todo list` / `ls` | Open tasks by group, what blocks them, and a summary. Filters: `--tag` (repeatable), `--assignee`, `--group`, `--ready`, `--blocked`; `--done` for done tasks, `--all` for both. | `{ title, description, sections: [{ name?, description, tasks: TaskView[] }], done: TaskView[] }` |
| `todo next` | The ready task(s) to work on next, in priority order. `--limit n` (default 1, 0 for all) and the `list` filters. | `TaskView[]` |
| `todo show <id>` | A task: state, description, dependencies, the tasks it blocks, comments. | `{ view: TaskView, dependencies: [{ id, title?, state }], blocks: TaskView[] }` |
| `todo add <title…>` | Add a task. `--group`, `--tag`, `--assignee`, `--depends-on`, `--description`, `--before`, `--after`. | the `Task` |
| `todo edit <id>` | Change a task: `--title`, `--description`, `--tag`/`--untag`, `--assignee`/`--unassign`, `--depends-on`/`--drop-dependency`. | the `Task` |
| `todo done <id…>` | Complete tasks and list those that became ready. | `[{ task, unblocked: TaskView[] }]` |
| `todo reopen <id>` | Reopen a done task at the end of its group. | the `Task` |
| `todo mv <id>` | Move a task: one of `--top`, `--bottom`, `--before <id>`, `--after <id>`, `--group <name>`, `--ungrouped`. | the `Task` |
| `todo rm <id>` | Delete a task and its file; `--force` if open tasks depend on it. | `{ removed: id }` |
| `todo comment <id> <text…>` | Add a comment; `--author`. | the `Comment` |
| `todo check` | Validate the list; exits 1 when it finds errors. | `Diagnostic[]` |
| `todo init [dir]` | Create a list (default `./todo`); `--title` (default: the directory's name). | `{ root }` |
| `todo fmt` | Normalize a hand-edited list: number new items, complete ticked ones, sync link text. | `{ assigned, finished, swept }` |

Where it helps, arguments are forgiving:

- IDs may be typed as shown (`07`) or bare (`7`).
- A title or comment made of several words doesn't need quotes: `todo add Fix the bug`.

A `TaskView` is `{ task, state: "ready" | "blocked" | "done", blockedBy: id[] }`;
see [`core`](../core).

## Global flags

| Flag | Meaning |
| --- | --- |
| `--json` | Print the result as one line of JSON on stdout. Failures print `{ "error": { tag, message, … } }` on stderr. |
| `--dir <path>` | The list's directory (the one holding `TODO.md`). Default: walking up from the working directory, the first `todo/TODO.md` or `TODO.md`. |
| `--help`, `-h` | Help for the command. |
| `--version` | The version. |

A comment's author comes from `--author`, then `$TODO_MD_AUTHOR`, then the OS
user name.

## Output

- **Human output** mirrors `TODO.md`: sections as headings, one line per task
  (`ID  title  #tags @assignee`), a `blocked by …` line under blocked tasks,
  and a summary.
- **Colors** are used only on a terminal, and never when `NO_COLOR` is set.
- **JSON output** is the command's result exactly, with dates as ISO 8601
  strings.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | The operation failed (no such task, invalid input, no list found, …) or `check` found errors. The reason is on stderr. |
| 2 | Usage error: an unknown command, a bad flag, or flags that contradict each other. |

## For agents

- **Scriptable output.** Use `--json` on every command, and read stdout only
  when the exit code is 0.
- **What to work on.** `todo next --json` returns the highest-priority ready
  task. `todo done <id> --json` reports what that unblocked.
- **Hand edits are safe.** Agents may edit `TODO.md` and task files directly;
  the next command normalizes them.
- **Concurrent writes are safe.** Commands from several agents at once
  serialize through the list's lock.

## Structure

| File | Responsibility |
| --- | --- |
| `bin.ts` | The executable: passes the process's arguments, working directory, environment and TTY state to `main`, and sets the exit code. |
| `main.ts` | The command tree (`todo`) and `main(args, context)` → exit code. |
| `context.ts` | `CliContext`, the global flags, list discovery, `withTodo` (wires `FsTodoStore` into `TodoService`), output, author. |
| `commands/*.ts` | The commands: `query` (list, next, show, check), `tasks` (add … comment), `lists` (init, fmt). |
| `render.ts`, `style.ts` | Human output. |
| `errors.ts` | CLI errors, their messages and exit codes. |

## Testing

- **End to end:** `test/cli` runs `main` against temporary lists and checks
  exact stdout, stderr and exit codes.
- **Help:** `help.test.ts` walks every command from `todo --help`, so a new
  command without a description, examples or described flags fails it.
- **The real executable:** `bin.test.ts` runs it as a separate process.

## May import (enforced by `test/boundaries.test.ts`)

- [`core`](../core)
- [`fs`](../fs)
- [`spec`](../spec)
- `effect`
- `@effect/platform-bun`
- `node:*` and `bun`

The CLI is the composition root: it wires `FsTodoStore` into `TodoService`.
```

In `docs/architecture.md`, in the `## cli` section, replace everything from its first paragraph through the `- **Non-interactive:**` bullet with the following. Keep the `- **Exit codes:**` and `- **Comment author:**` bullets that follow it.

````markdown
The CLI is built with `effect/unstable/cli` (`Command`, `Flag`, `Argument`,
`GlobalFlag`) and runs on `BunRuntime`. It is the composition root. Each
command resolves the list root (from `--dir`, or `findListRoot`) and runs
against `TodoService` over `FsTodoStore`:

```ts
// context.ts
const withTodo = (f) =>
  Effect.gen(function* () {
    const root = yield* listRoot
    return yield* f(yield* TodoService).pipe(
      Effect.provide(TodoService.layer),
      Effect.provide(FsTodoStore.layer({ root })),
    )
  })

// bin.ts
main(process.argv.slice(2), { cwd, env, username, color }).pipe(
  Effect.tap((code) => Effect.sync(() => { process.exitCode = code })),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
)
```

- **Testable entry point.** `main(args, context)` runs the command tree with
  `Command.runWith` and returns the exit code. Tests pass their own working
  directory, environment and color setting.
- **Commands:** `list`/`ls` (also plain `todo`), `next`, `show`, `add`,
  `edit`, `done`, `reopen`, `mv`, `rm`, `comment`, `check`, `init`, `fmt`.
  The full surface is in the [cli README](../src/cli/README.md).
- **Help:** every command has `--help` with a description, every flag, and
  examples. A test walks the command tree to keep it that way.
- **Output:** human output mirrors `TODO.md`. `--json` (a global flag,
  accepted anywhere) prints the result exactly on stdout, and failures as JSON
  on stderr.
- **Non-interactive:** the CLI never prompts.
````

In `README.md`, insert this section before `## Development`:

````markdown
## Using the CLI

```sh
todo init                              # create ./todo/TODO.md
todo add Fix the login redirect --group Backend --tag bug
todo                                   # show the open tasks
todo next --json                       # what to work on next, as JSON
todo done 1
todo --help                            # every command has --help
```

Run it with `bun src/cli/bin.ts` from a checkout, `bun link` it, or get
`todo` from `node_modules/.bin` when `@lemol/todo-md` is a dependency. See
the [cli README](src/cli/README.md).
````

In `AGENTS.md`:

1. In the `## Commands` code block, add this line after `bun run fix           # apply Biome fixes`:

   ```sh
   bun src/cli/bin.ts    # run the todo CLI from source
   ```

2. In `## Rules`, add this bullet before the `- **Docs.**` bullet:

   ```markdown
   - **CLI help.** Every command needs a description, a description for each
     flag and argument, and examples; `test/cli/help.test.ts` checks every
     command.
   ```

- [ ] **Step 7: Run the gate and commit**

Run: `bun run check`
Expected: lint and typecheck clean; `364 pass`, `0 fail` (307 before this plan + 57 cli).

Run: `git ls-files -s src/cli/bin.ts` (after `git add`). Expected: mode `100755`.

```bash
git add src/cli package.json docs/architecture.md README.md AGENTS.md test/cli
git commit -m "Ship the todo executable with help on every command" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```
