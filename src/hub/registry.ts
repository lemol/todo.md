/**
 * `<home>/projects.yaml`: a map from project name to `{ source, ...config }`
 * under the top-level key `projects`. Edits go through yaml's `Document`, so
 * comments and order survive; they run under `<home>/.todo.lock` on a fresh
 * read and are written atomically.
 */

import { Effect, FileSystem, Path } from "effect"
import {
  type Document,
  isMap,
  isNode,
  isScalar,
  type Pair,
  parseDocument,
  type YAMLMap,
} from "yaml"
import { makeLock } from "../fs/index.ts"
import { RegistryError } from "./errors.ts"

export const registryFile = "projects.yaml"

export interface RegistryEntry {
  readonly name: string
  /** The entry as written: `source` plus the source's config fields. */
  readonly value: unknown
}

/** The registry file being edited. */
export interface RegistryEdit {
  has(name: string): boolean
  /** Appends an entry. */
  add(name: string, value: Readonly<Record<string, unknown>>): void
  delete(name: string): void
  /** Renames an entry, keeping its position and comments. */
  rename(from: string, to: string): void
}

export interface Registry {
  /** Every entry, in file order. A missing file is an empty registry. */
  readonly entries: Effect.Effect<ReadonlyArray<RegistryEntry>, RegistryError>
  /** Under the lock: reads the file afresh, runs `edit`, then writes the file atomically. */
  update<A, E>(
    edit: (registry: RegistryEdit) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | RegistryError>
}

const keyOf = (pair: Pair): string => String(isScalar(pair.key) ? pair.key.value : pair.key)

const editOf = (doc: Document): RegistryEdit => {
  const projects = (): YAMLMap | undefined => {
    const node = doc.get("projects", true)
    return isMap(node) ? node : undefined
  }
  const pairOf = (name: string) => projects()?.items.find((pair) => keyOf(pair) === name)
  return {
    has: (name) => pairOf(name) !== undefined,
    add: (name, value) => {
      const map = projects()
      if (map === undefined) {
        doc.set("projects", doc.createNode({ [name]: value }))
        return
      }
      // `projects: {}` parses as a flow map; entries read better as a block.
      if (map.items.length === 0) map.flow = false
      map.add(doc.createPair(name, value))
    },
    // Not `YAMLMap.delete`: it compares raw scalar values, so it would miss a key like `2024:`.
    delete: (name) => {
      const map = projects()
      const pair = pairOf(name)
      if (map !== undefined && pair !== undefined) map.items.splice(map.items.indexOf(pair), 1)
    },
    rename: (from, to) => {
      const pair = pairOf(from)
      if (pair === undefined) return
      if (isScalar(pair.key)) pair.key.value = to
      else pair.key = doc.createNode(to)
    },
  }
}

export const makeRegistry = (
  home: string,
): Effect.Effect<Registry, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = path.join(home, registryFile)
    const lock = yield* makeLock(home)
    const failure = (message: string) => (cause: unknown) => new RegistryError({ message, cause })

    const read = Effect.gen(function* () {
      const text = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : ""
      return parseDocument(text)
    }).pipe(
      Effect.mapError(failure(`could not read ${file}`)),
      Effect.flatMap((doc) => {
        const [error] = doc.errors
        if (error !== undefined) {
          return Effect.fail(new RegistryError({ message: `${file}: ${error.message}` }))
        }
        if (doc.contents !== null && !isMap(doc.contents)) {
          return Effect.fail(new RegistryError({ message: `${file}: expected a map` }))
        }
        const projects = doc.get("projects", true)
        if (
          projects !== undefined &&
          !isMap(projects) &&
          !(isScalar(projects) && projects.value === null)
        ) {
          return Effect.fail(new RegistryError({ message: `${file}: projects must be a map` }))
        }
        return Effect.succeed(doc)
      }),
    )

    const write = (doc: Document) =>
      fs
        .writeFileString(`${file}.tmp`, doc.toString())
        .pipe(
          Effect.andThen(fs.rename(`${file}.tmp`, file)),
          Effect.mapError(failure(`could not write ${file}`)),
        )

    return {
      entries: Effect.map(read, (doc) => {
        const projects = doc.get("projects", true)
        if (!isMap(projects)) return []
        return projects.items.map((pair) => ({
          name: keyOf(pair),
          value: isNode(pair.value) ? pair.value.toJS(doc) : pair.value,
        }))
      }),

      update: <A, E>(edit: (registry: RegistryEdit) => Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          yield* fs
            .makeDirectory(home, { recursive: true })
            .pipe(Effect.mapError(failure(`could not create ${home}`)))
          const edited = Effect.gen(function* () {
            const doc = yield* read
            const result = yield* edit(editOf(doc))
            yield* write(doc)
            return result
          })
          // The exit keeps the edit's own errors apart from the lock's `StoreError`.
          const exit = yield* lock(Effect.exit(edited)).pipe(
            Effect.mapError(
              (error) =>
                new RegistryError({
                  message: `could not lock the registry: ${error.message}`,
                  cause: error,
                }),
            ),
          )
          return yield* exit
        }),
    }
  })
