import { Effect } from "effect"
import {
  allItems,
  basename,
  fileTask,
  groupSlug,
  inlineTask,
  joinPath,
  parseId,
  parseTaskFile,
  staleLinkText,
  type TaskFile,
  type TodoFile,
  type TodoItem,
  type TodoSection,
} from "../markdown/index.ts"
import { type Diagnostic, StoreError, type Task, type TaskId, unique } from "../spec/index.ts"
import type { Files } from "./files.ts"
import type { Parser } from "./parsing.ts"

export const todoPath = "TODO.md"

/** An item in `TODO.md` that has an ID, with its task file when it is linked. */
export interface Entry {
  readonly id: TaskId
  readonly item: TodoItem
  readonly section: TodoSection
  /** The linked task file's text and parse, when it exists. */
  readonly source: string | undefined
  readonly file: TaskFile | undefined
}

/** A file in the done directory. */
export interface DoneEntry {
  readonly id: TaskId
  readonly path: string
  readonly source: string
  readonly file: TaskFile
}

/** Everything a list holds on disk, read at one moment. */
export interface Snapshot {
  /** `TODO.md` as read. */
  readonly source: string
  readonly todo: TodoFile
  /** Items with an ID, in document order. */
  readonly entries: ReadonlyArray<Entry>
  readonly done: ReadonlyArray<DoneEntry>
  /** Every ID in use: items, task file names and done file names (spec §2.7). */
  readonly usedIds: ReadonlyArray<TaskId>
  /** Frontmatter titles of linked task files, by path. */
  readonly titles: ReadonlyMap<string, string>
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

const taskFileName = /^\d+-.*\.md$/

const idOfFile = (path: string): TaskId | undefined =>
  taskFileName.test(basename(path)) ? parseId(basename(path).split("-")[0] ?? "") : undefined

const isUnder = (path: string, dir: string) => dir === "." || path.startsWith(`${dir}/`)

const title = (entry: Entry) => entry.file?.title ?? entry.item.title

/** Whether a done file has this ID and title: a completion was interrupted (spec §2.10). */
const matchesDone = (done: ReadonlyArray<DoneEntry>, id: TaskId, title: string): boolean =>
  done.some((entry) => entry.id === id && (entry.file.title ?? "") === title)

/** An open entry whose completion was interrupted: a done file has its ID and title. */
export const isInterrupted = (snapshot: Snapshot, entry: Entry): boolean =>
  matchesDone(snapshot.done, entry.id, title(entry))

/** The model task for an entry: done when its box is checked. */
export const entryTask = (entry: Entry): Task => {
  const status = entry.item.checked ? "done" : "open"

  return entry.item.linked
    ? fileTask(entry.id, entry.file ?? parseTaskFile("", entry.item.path ?? ""), {
        title: entry.item.title,
        status,
        group: entry.section.name,
      })
    : inlineTask(entry.item, entry.id, entry.section.name)
}

export const doneTask = (done: DoneEntry): Task =>
  fileTask(done.id, done.file, {
    title: basename(done.path).replace(/^\d+-/, "").replace(/\.md$/, ""),
    status: "done",
    group: done.file.group,
  })

/** Reads the whole list. Never writes to it; unchanged files reuse their last parse. */
export const readSnapshot = (files: Files, parser: Parser): Effect.Effect<Snapshot, StoreError> =>
  Effect.acquireUseRelease(
    parser.begin,
    () => readWith(files, parser),
    () => parser.end,
  )

const readWith = (files: Files, parser: Parser): Effect.Effect<Snapshot, StoreError> =>
  Effect.gen(function* () {
    const source = yield* files.read(todoPath)

    if (source === undefined) {
      return yield* new StoreError({ message: `no ${todoPath} in ${files.root}` })
    }

    const todo = parser.todoFile(source)
    const { tasksDir, doneDir } = todo.config
    const diagnostics: Diagnostic[] = [...todo.diagnostics]

    // Every file the snapshot needs, read concurrently: done files, then linked task files.
    const donePaths = (yield* files.list(doneDir, { recursive: true })).filter(
      (path) => idOfFile(path) !== undefined,
    )

    const linkedPaths = todo.sections.flatMap((section) =>
      section.items.flatMap((item) =>
        item.id === undefined || item.path === undefined ? [] : [item.path],
      ),
    )

    const texts = new Map<string, string | undefined>()
    yield* Effect.forEach(
      unique([...donePaths, ...linkedPaths]),
      (path) => Effect.map(files.read(path), (text) => texts.set(path, text)),
      { concurrency: 16, discard: true },
    )

    const done: DoneEntry[] = []

    for (const path of donePaths) {
      const id = idOfFile(path)
      const text = texts.get(path)

      if (id === undefined || text === undefined) continue

      const file = parser.taskFile(path, text)
      diagnostics.push(...file.diagnostics)
      done.push({ id, path, source: text, file })
    }

    const entries: Entry[] = []

    for (const section of todo.sections) {
      for (const item of section.items) {
        if (item.id === undefined) continue

        const path = item.path
        const text = path === undefined ? undefined : texts.get(path)
        const file =
          path === undefined || text === undefined ? undefined : parser.taskFile(path, text)

        const entry: Entry = { id: item.id, item, section, source: text, file }
        const location = { taskId: item.id, file: todoPath, line: item.start + 1 }

        if (file !== undefined) {
          diagnostics.push(...file.diagnostics)
          const stale = file.title === undefined ? undefined : staleLinkText(item, file.title)

          if (stale !== undefined) diagnostics.push(stale)
        }

        if (matchesDone(done, item.id, title(entry))) {
          diagnostics.push({
            severity: "warning",
            code: "interrupted-completion",
            message: `task ${item.id} is both open and done; the next change finishes completing it`,
            ...location,
          })
        } else if (item.linked && path !== undefined && text === undefined) {
          diagnostics.push({
            severity: "error",
            code: "broken-link",
            message: `${path} does not exist`,
            ...location,
          })
        }

        entries.push(entry)
      }
    }

    // Task files live in the tasks directory and its group directories (spec §2.8).
    const taskDirs = new Set([
      tasksDir,
      ...todo.sections.flatMap((s) =>
        s.name === undefined ? [] : [joinPath(tasksDir, groupSlug(s.name))],
      ),
    ])

    const taskFiles: string[] = []

    for (const dir of taskDirs) {
      for (const path of yield* files.list(dir)) {
        if (idOfFile(path) !== undefined && !isUnder(path, doneDir)) taskFiles.push(path)
      }
    }

    const linked = new Set(
      allItems(todo).flatMap((item) => (item.path === undefined ? [] : [item.path])),
    )

    for (const path of taskFiles.filter((candidate) => !linked.has(candidate))) {
      diagnostics.push({
        severity: "warning",
        code: "orphan-file",
        message: `no item links to ${path}`,
        file: path,
      })
    }

    // Each ID names one task: across items, and between items and done files
    // (except an interrupted completion, reported above).
    const seen = new Map<TaskId, string>()

    const claim = (id: TaskId, where: string) => {
      const first = seen.get(id)

      if (first === undefined) seen.set(id, where)
      else {
        diagnostics.push({
          severity: "error",
          code: "duplicate-id",
          message: `task ${id} appears in ${first} and ${where}`,
          taskId: id,
        })
      }
    }

    for (const entry of entries) claim(entry.id, `${todoPath}:${entry.item.start + 1}`)

    for (const entry of done) {
      const open = entries.find((candidate) => candidate.id === entry.id)

      if (open === undefined || !matchesDone([entry], open.id, title(open))) {
        claim(entry.id, entry.path)
      }
    }

    return {
      source,
      todo,
      entries,
      done,
      usedIds: unique([
        ...entries.map((entry) => entry.id),
        ...done.map((entry) => entry.id),
        ...taskFiles.flatMap((path) => idOfFile(path) ?? []),
      ]),
      titles: new Map(
        entries.flatMap((entry) =>
          entry.item.path !== undefined && entry.file?.title !== undefined
            ? [[entry.item.path, entry.file.title] as const]
            : [],
        ),
      ),
      diagnostics,
    }
  })
