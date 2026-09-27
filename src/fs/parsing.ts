/**
 * Parses a list's files, remembering each parse by path and text. Parsing is
 * nearly all the cost of a read (Markdown to a syntax tree), and between two
 * reads almost every file is unchanged, so an unchanged file is not parsed
 * again. Parses are kept in memory for the store's lifetime and, given a
 * cache file, on disk between processes.
 *
 * The cache is never a source of truth: every read still reads every file,
 * and only an identical text, at the same path, reuses a parse. So hand edits
 * are always seen and nothing needs invalidating.
 */

import { Effect, FileSystem, Path, Random, Schema } from "effect"
import {
  parseTaskFile,
  parseTodoFile,
  type TaskFile,
  type TodoFile,
  taskFileParserVersion,
} from "../markdown/index.ts"
import { Diagnostic } from "../spec/index.ts"

export interface Parser {
  readonly todoFile: (source: string) => TodoFile
  readonly taskFile: (path: string, source: string) => TaskFile
  /** Starts a read: loads the cache file the first time. */
  readonly begin: Effect.Effect<void>
  /** Ends a read: forgets parses no read used since the last `end`, then saves the cache file if any parse was new. */
  readonly end: Effect.Effect<void>
}

/** cyrb53: a fast 53-bit string hash. The cache key also holds the length and path. */
const hash = (text: string): string => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const keyOf = (path: string, source: string) => `${path}:${source.length}:${hash(source)}`

const CachedTaskFile = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  tags: Schema.Array(Schema.String),
  assignee: Schema.optionalKey(Schema.String),
  dependsOn: Schema.Array(Schema.String),
  extra: Schema.Record(Schema.String, Schema.Json),
  description: Schema.String,
  comments: Schema.Array(
    Schema.Struct({
      author: Schema.String,
      at: Schema.DateTimeUtcFromMillis,
      body: Schema.String,
    }),
  ),
  group: Schema.optionalKey(Schema.String),
  completedAt: Schema.optionalKey(Schema.DateTimeUtcFromMillis),
  outcome: Schema.optionalKey(Schema.Literals(["completed", "cancelled"])),
  cancelledReason: Schema.optionalKey(Schema.String),
  diagnostics: Schema.Array(Diagnostic),
})

const CacheFile = Schema.Struct({
  version: Schema.Literal(taskFileParserVersion),
  root: Schema.String,
  /** Parses by `keyOf`. Undecodable ones are dropped, not fatal. */
  entries: Schema.Record(Schema.String, Schema.Unknown),
})

const CacheJson = Schema.fromJsonString(CacheFile)
const decodeEntry = Schema.decodeUnknownOption(CachedTaskFile)
const encodeEntry = Schema.encodeUnknownOption(CachedTaskFile)

/** Drops `undefined` fields, which JSON cannot hold, so the entry encodes. */
const defined = (file: TaskFile): Record<string, unknown> =>
  Object.fromEntries(Object.entries(file).filter(([, value]) => value !== undefined))

const restore = (cached: typeof CachedTaskFile.Type): TaskFile => ({
  title: cached.title,
  tags: cached.tags,
  assignee: cached.assignee,
  dependsOn: cached.dependsOn,
  extra: cached.extra,
  description: cached.description,
  comments: cached.comments,
  group: cached.group,
  completedAt: cached.completedAt,
  outcome: cached.outcome,
  cancelledReason: cached.cancelledReason,
  diagnostics: cached.diagnostics,
})

/**
 * A parser for the list at `root`. With `cacheDir`, parses are also kept in
 * a file there, named after `root`; the file is best-effort and a missing,
 * stale or unreadable one is ignored.
 */
export const makeParser = (
  root: string,
  cacheDir: string | undefined,
): Effect.Effect<Parser, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = cacheDir === undefined ? undefined : path.join(cacheDir, `${hash(root)}.json`)

    let taskFiles = new Map<string, TaskFile>()
    let used = new Map<string, TaskFile>()
    let fresh = false
    let loaded = false
    let lastTodo: { readonly source: string; readonly todo: TodoFile } | undefined

    const load = Effect.gen(function* () {
      loaded = true
      if (file === undefined) return
      const cache = yield* fs
        .readFileString(file)
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(CacheJson)), Effect.option)
      if (cache._tag === "None" || cache.value.root !== root) return
      for (const [key, value] of Object.entries(cache.value.entries)) {
        const decoded = decodeEntry(value)
        if (decoded._tag === "Some") taskFiles.set(key, restore(decoded.value))
      }
    })

    const save = Effect.gen(function* () {
      if (file === undefined || cacheDir === undefined) return
      const entries: Record<string, unknown> = {}
      for (const [key, taskFile] of taskFiles) {
        const encoded = encodeEntry(defined(taskFile))
        if (encoded._tag === "Some") entries[key] = encoded.value
      }
      const text = JSON.stringify({ version: taskFileParserVersion, root, entries })
      const token = yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER)
      const temporary = `${file}.${token.toString(36)}.tmp`
      yield* fs.makeDirectory(cacheDir, { recursive: true })
      yield* fs.writeFileString(temporary, text).pipe(
        Effect.andThen(fs.rename(temporary, file)),
        Effect.onError(() => Effect.ignore(fs.remove(temporary))),
      )
    })

    return {
      todoFile: (source) => {
        if (lastTodo?.source !== source) lastTodo = { source, todo: parseTodoFile(source) }
        return lastTodo.todo
      },
      taskFile: (at, source) => {
        const key = keyOf(at, source)
        let parsed = used.get(key) ?? taskFiles.get(key)
        if (parsed === undefined) {
          parsed = parseTaskFile(source, at)
          fresh = true
        }
        used.set(key, parsed)
        return parsed
      },
      begin: Effect.suspend(() => (loaded ? Effect.void : load)),
      end: Effect.suspend(() => {
        taskFiles = used
        used = new Map()
        if (!fresh) return Effect.void
        fresh = false
        return Effect.ignore(save)
      }),
    }
  })
