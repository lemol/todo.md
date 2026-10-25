# Cancelling a task

Not every task is finished. Some are abandoned: the premise changed, the work
was done elsewhere, the idea was wrong. Today the model has one way out of the
list, `complete`, so abandoning a task means recording a completion that never
happened.

This design adds cancellation as an **outcome of being done**, not as a third
status.

## Why now

Three pressures, each independent:

1. **The archive lies.** `todo/done/12-register-apps-in-a-consuming-monorepo.md`
   records `completed_at: 2026-09-18T19:13:18Z` for work nobody did: the task
   asked to register `apps/*` in a consuming monorepo, and commit
   `d47fcd2` had already moved the web app into `src/web`, leaving no `apps/`
   directory. Spec §2.6 makes `completed_at` REQUIRED in done files, so there
   is no way to file a task as "finished with" rather than "completed".

2. **Dependencies have no answer.** §1.3 defines a dependency as satisfied
   when it refers to a done task. Abandoned work has no defined behaviour.
   Live case: task 06 (Add the Jira source) is blocked by task 13 (Make add
   and remove store capabilities). If 13 were dropped, the only options are to
   fake-complete it or leave 06 blocked forever.

3. **The adapters force it.** Task 06 is the Jira source. Jira resolves issues
   as Won't Do and Duplicate as a first-class outcome. Those issues must map
   to something: `done` misreports them, `open` parks them in `next` forever.

## The shape: outcome, not status

`status` stays `open | done`. A done task carries an `outcome`.

The alternative considered was a third status, `open | done | cancelled`. It
was rejected on the evidence of the existing code: nearly every
`status === "done"` check means *archived, not open* rather than *finished
successfully*.

| Site | What `"done"` means there |
| ---- | ------------------------- |
| `src/core/TodoService.ts:150` | Archived tasks get no sections |
| `src/markdown/convert.ts:82` | Archived tasks carry a recorded group |
| `src/fs/snapshot.ts:88`, `src/fs/writing.ts:47` | Archive read and write |
| `src/spec/model.ts:18` | `TaskStatus = Schema.Literals(["open", "done"])` |

Under a third status every one of those needs auditing to decide which meaning
was intended, and each is a chance to get it wrong. Under an outcome they are
all correct as written, including the Schema literal that every derived type
hangs off.

The framing also matches Jira, the adapter that motivates it: Jira has a
resolved status category plus a separate resolution field. `outcome` maps onto
resolution directly.

**The cost, stated plainly.** Making cancelled a kind of done means §1.3's
"satisfied when it refers to a done task" silently starts treating cancelled
dependencies as satisfied. That is not the behaviour we want, so the clause is
overridden deliberately (below). One clause of the framing's elegance is spent
to keep the semantics right.

## Part 1: model and operations

### §1.1 Task

Two fields join the table:

| Field             | Type                       | Notes                                                                                                       |
| ----------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `outcome`         | `completed` \| `cancelled` | Absent while open. **Absent on a done task means `completed`**, so every existing done file reads correctly. |
| `cancelledReason` | string?                    | Why the task was abandoned. Required by `cancel`. MAY be absent on a task cancelled by hand and not yet normalized, mirroring the existing allowance for `completedAt`. |

`status` and `completedAt` are unchanged. `completedAt` means "when the task
reached done", whatever the outcome; the outcome says how to read it. This
keeps §2.6's REQUIRED rule, §2.8's paths, and the archive readers and writers
untouched.

No migration is needed. A done file with no `outcome` key is a completed task.

### §1.3 Derived state

One clause changes:

> A dependency is **satisfied** when it refers to a task that is done with
> outcome `completed`.

Everything else stands. "Ready" and "blocked" are defined over open tasks, so
a cancelled task is neither. A dependency on a cancelled task is unsatisfied,
and reported as a diagnostic (§1.6).

This is the entire dependency semantic, and it lands in one place:
`src/core/views.ts:44` builds `doneIds` from every done task, and `viewOf`
filters against that set. The set is built from completed tasks only.

### §1.4 Operations

One row joins the table:

| Operation              | Semantics                                                                                                                                     | Errors                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `cancel(id, reason)`   | open → done with outcome `cancelled`. Sets `completedAt` to now, records `group` and `cancelledReason`. Cancelling a blocked task MUST be allowed. | `TaskNotFound`, `InvalidTransition`, `ValidationError` (empty reason), `Unsupported` |

Amendments to existing rows:

- `complete(id)` sets `outcome` to `completed`.
- `reopen(id)` clears `outcome` and `cancelledReason` along with `completedAt`.
  It already handles done → open, and cancelled tasks are done, so the
  transition needs no new case.
- `cancel` on a task that is already done is `InvalidTransition`. Reopen
  first. Only open tasks can be cancelled, which keeps the transition graph a
  star around `open`.

`listDone()` is unchanged: it returns done tasks, cancelled ones included.

### §1.5 Capabilities

`cancel` is a capability, not a required operation. The always-required set
is unchanged: `load`, `get`, `listDone`, `add`, `update`, `complete`,
`reopen`, `remove`.

| Capability | When absent                                                                       |
| ---------- | --------------------------------------------------------------------------------- |
| `cancel`   | `cancel` fails with `Unsupported`; no task has outcome `cancelled`.               |

The second clause mirrors `comments`, which gates both the operation and the
data it produces. A store that cannot record abandonment will not surface it
either, so consumers can treat "this store has no cancel capability" as "every
done task here is completed" without a second check.

§1.5 already directs tools to hide unsupported operations rather than offer
them and fail, so the CLI and web app gate the cancel action on the
capability.

**What this gives up.** "Was this abandoned?" becomes a question the model can
answer per store rather than universally, which softens the honest-archive
goal for backends that decline the capability. It holds for the file-system
store, which is the reference implementation and the one the goal was about.

### §1.6 Diagnostics

| Code                   | Severity | Condition                               |
| ---------------------- | -------- | --------------------------------------- |
| `cancelled-dependency` | warning  | `dependsOn` refers to a cancelled task. |

Warning, not error: cancelling upstream work is a decision point for its
dependents, not a broken list. The dependent may need redesigning, may need
cancelling too, or may genuinely no longer need the dependency. The tool flags
it and leaves the call to a human.

`add` and `update` do **not** reject a dependency on a cancelled task. §1.6
reserves hard failure for self-dependency and cycles, which are unsatisfiable
by construction; this is a judgment call, which is what warnings are for.

A task blocked only by cancelled dependencies stays blocked. That is the
intended behaviour, and the diagnostic is what stops it being invisible:
`todo check` surfaces it.

## Part 2: format

### §2.4 Task items

Unchanged. `[ ]` is open, `[x]` is done-not-yet-archived and normalizes to
outcome `completed`. There is no `[-]` glyph.

Two reasons. GFM recognizes only `[ ]`, `[x]` and `[X]`, so a `[-]` item
renders as literal text on GitHub and loses its checkbox; and
`src/markdown/todoFile.ts:118` reads `node.checked` from remark-gfm, which
does not report a third glyph at all, so supporting one means parsing
checkboxes below the GFM layer.

The cost: there is no hand-written way to cancel. Use the CLI, or edit the
archived file's frontmatter. A cancellation carries a required reason, which a
one-glyph shorthand could not express anyway.

### §2.5 Metadata line

`outcome` and `cancelled_reason` join `title`, `completed_at`, `group` and
`id` as reserved keys. An open task has no outcome; setting one from a
metadata line is a `reserved-field` diagnostic (error).

### §2.6 Task files

Two fields join the frontmatter table, both done-files-only:

| Field              | Type                       | Notes                                                                    |
| ------------------ | -------------------------- | ------------------------------------------------------------------------ |
| `outcome`          | `completed` \| `cancelled` | Absent means `completed`. Any other value is `invalid-frontmatter` (error). |
| `cancelled_reason` | string                     | Only meaningful with `outcome: cancelled`. Present otherwise is `invalid-frontmatter` (error). |

`completed_at` keeps its rule verbatim: done files only, REQUIRED there.

Either key in an **open** task's file is `invalid-frontmatter` (error), and
the field is ignored. An open task has no outcome, so the file is stating
something the model cannot hold.

A cancelled task file:

```markdown
---
title: Register apps/* in a consuming monorepo
tags: [web]
completed_at: 2026-09-18T19:13:18Z
outcome: cancelled
cancelled_reason: Superseded by d47fcd2, which moved the web app into src/web.
  There is no apps/ directory, and the monorepo already covers todo-md.
---
```

### §2.8 Paths, §2.11 Normalization

Unchanged. Cancelled files live in `done_dir` under the existing convention,
`<done_dir>/<group-slug>/<id>-<title-slug>.md`.

## Part 3: implementation

| Where | Change |
| ----- | ------ |
| `src/spec/model.ts` | `TaskOutcome` literal; two optional fields on `Task`. `TaskStatus` untouched. |
| `src/spec/TodoStore.ts` | `cancel(id, reason)`; `cancel` joins `Capabilities`. |
| `src/spec/MemoryTodoStore.ts` | Implement, mirroring `complete` at line 275. Add a `cancel: false` variant beside the `promote: false` one at line 183, to exercise the absent path. |
| `src/spec/testing/conformance/cancelling.ts` | New file, following `promotion.ts`: cases marked `requires: ["cancel"]`, plus one asserting `Unsupported` when the capability is absent. `index.ts:38` already skips gated cases. |
| `src/core/views.ts:44` | Satisfying set built from completed tasks only. |
| `src/core/check.ts` | `cancelled-dependency`, beside `unknown-dependency` at line 33. |
| `src/markdown/taskFile.ts`, `convert.ts` | Read and write the two keys. |
| `src/fs/snapshot.ts`, `writing.ts` | Archive read and write. |
| `src/cli/commands/tasks.ts` | `todo cancel <id> --reason <text>`, and `--reason -` for stdin. Gated on the capability per §1.5. |
| `src/cli/render.ts` | Distinguish cancelled tasks in listings. |
| `src/web/app/ui/task.tsx:15` | The hardcoded `"Completed"` label becomes outcome-aware; cancel action in the controller, hidden when the capability is absent. |

Constraints from the repo's rules:

- Every CLI command needs a description, a description per flag and argument,
  and examples. `test/cli/help.test.ts` checks every command.
- Writers splice text rather than re-serializing (§2.10).
- `test/boundaries.test.ts` is unaffected: no new modules, no new imports
  across module boundaries.
- `bun run check` is the gate.

## Out of scope

- Cancellation reasons as structured values (duplicate-of, superseded-by).
  A string first; structure later if the string proves insufficient.
- A `[-]` checkbox glyph, for the reasons in §2.4 above.
- Filtering listings by outcome (`todo ls --cancelled`). The data will be
  there; add the filter when someone wants it.
- Cascading cancellation to dependents. The diagnostic surfaces the decision;
  a human makes it.

## First use

Task 12 is the test case. Once `cancel` exists, reopen it and cancel it with
the reason recorded above, replacing the false completion that prompted this
design.
