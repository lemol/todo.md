/**
 * `<home>/projects.yaml`: a map from project name to `{ source, ...config }`
 * under the top-level key `projects`. Edits go through yaml's `Document`, so
 * comments and order survive; they run under `<home>/.todo.lock` on a fresh
 * read and are written atomically.
 */

import { Effect, FileSystem, Path } from "effect"
import {
  type Document,
  isAlias,
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

    // Keep the file position, but not the colon introducing YAML's omitted code frame.
    const yamlFailure = (cause: unknown) => {
      const head =
        (cause instanceof Error ? cause.message : String(cause)).split(/\r\n|\r|\n/)[0] ?? ""

      return new RegistryError({
        message: `${file}: ${head.replace(/( at line \d+, column \d+):$/, "$1")}`,
        cause,
      })
    }

    const read = Effect.gen(function* () {
      const text = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : ""

      return text
    }).pipe(
      Effect.mapError(failure(`could not read ${file}`)),
      Effect.flatMap((text) =>
        Effect.try({
          try: () => {
            const doc = parseDocument(text)
            const [error] = doc.errors

            if (error !== undefined) throw error

            // `toJS` throws what `parseDocument` leaves unreported: an alias to a missing
            // anchor, or an alias bomb. Checking the whole document here covers every caller.
            doc.toJS({ mapAsMap: true })

            if (doc.contents !== null && !isMap(doc.contents)) {
              return { failed: "expected a map" } as const
            }

            const projects = doc.get("projects", true)

            if (isAlias(projects)) {
              return { failed: "projects must be a map, not an alias" } as const
            }

            if (
              projects !== undefined &&
              !isMap(projects) &&
              !(isScalar(projects) && projects.value === null)
            ) {
              return { failed: "projects must be a map" } as const
            }

            const entries: ReadonlyArray<RegistryEntry> = isMap(projects)
              ? projects.items.map((pair) => ({
                  name: keyOf(pair),
                  value: isNode(pair.value) ? pair.value.toJS(doc) : pair.value,
                }))
              : []

            return { doc, entries } as const
          },
          catch: yamlFailure,
        }),
      ),
      Effect.flatMap((result) =>
        "failed" in result
          ? Effect.fail(new RegistryError({ message: `${file}: ${result.failed}` }))
          : Effect.succeed(result),
      ),
    )

    const write = (doc: Document) =>
      Effect.try({
        try: () => doc.toString(),
        catch: (cause) => {
          // `read` accepted the file, so an unresolved alias here is the edit's doing.
          const alias = /^Unresolved alias[^\n]*: (.+)$/m.exec(
            cause instanceof Error ? cause.message : "",
          )

          return alias === null
            ? yamlFailure(cause)
            : new RegistryError({
                message: `${file}: the edit would leave alias *${alias[1]} unresolved`,
                cause,
              })
        },
      }).pipe(
        Effect.flatMap((text) =>
          fs
            .writeFileString(`${file}.tmp`, text)
            .pipe(
              Effect.andThen(fs.rename(`${file}.tmp`, file)),
              Effect.mapError(failure(`could not write ${file}`)),
            ),
        ),
      )

    return {
      entries: Effect.map(read, ({ entries }) => entries),

      update: <A, E>(edit: (registry: RegistryEdit) => Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          yield* fs
            .makeDirectory(home, { recursive: true })
            .pipe(Effect.mapError(failure(`could not create ${home}`)))
          const edited = Effect.gen(function* () {
            const { doc } = yield* read
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
