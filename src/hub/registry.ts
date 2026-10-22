/**
 * `<home>/projects.yaml`: a map from project name to `{ source, ...config }`
 * under the top-level key `projects`. Edits splice the entry they change;
 * yaml's `Document` parses and validates. Missing, empty or flow-style projects
 * fall back to Document edits. All edits run under `<home>/.todo.lock` on a
 * fresh read and are written atomically.
 */

import { Effect, FileSystem, Path } from "effect"
import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  type Pair,
  parseDocument,
  stringify,
  type YAMLMap,
  YAMLParseError,
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

/** Count complete LF, CRLF and lone CR endings, matching the file line model. */
const offsetLineCol = (
  text: string,
  offset: number,
): { readonly line: number; readonly col: number } => {
  let line = 1
  let start = 0

  for (const match of text.matchAll(/\r\n?|\n/g)) {
    const end = (match.index ?? 0) + match[0].length

    if (end > offset) break

    line++

    start = end
  }

  return { line, col: offset - start + 1 }
}

const editOf = (
  original: string,
): { readonly edit: RegistryEdit; readonly render: () => string } => {
  let text = original
  let doc = parseDocument(text)
  let rewritten = false

  const projects = (): YAMLMap | undefined => {
    const node = doc.get("projects", true)

    return isMap(node) ? node : undefined
  }

  const pairOf = (name: string) => projects()?.items.find((pair) => keyOf(pair) === name)

  const splice = (start: number, end: number, replacement: string) => {
    text = text.slice(0, start) + replacement + text.slice(end)
    doc = parseDocument(text)
  }

  const lineStart = (offset: number) => text.lastIndexOf("\n", offset - 1) + 1

  const lineEnd = (offset: number) => {
    const end = text.indexOf("\n", offset)

    return end === -1 ? text.length : end + 1
  }

  const endOf = (pair: Pair) => {
    const node = pair.value ?? pair.key

    return isNode(node) && node.range != null ? lineEnd(node.range[1] - 1) : undefined
  }

  const block = (map: YAMLMap | undefined) =>
    !rewritten && map !== undefined && !map.flow && map.items.length > 0

  const edit: RegistryEdit = {
    has: (name) => pairOf(name) !== undefined,
    add: (name, value) => {
      const map = projects()
      const first = map?.items[0]?.key
      const last = map?.items.at(-1)
      const end = last === undefined ? undefined : endOf(last)

      if (block(map) && isNode(first) && first.range != null && end !== undefined) {
        const indent = /^ */.exec(text.slice(lineStart(first.range[0])))?.[0] ?? ""
        const entry = stringify({ [name]: value }, { lineWidth: 0 })
          .trimEnd()
          .split("\n")
          .map((line) => indent + line)
          .join("\n")

        const separator = end > 0 && text[end - 1] !== "\n" ? "\n" : ""

        splice(end, end, `${separator}${entry}\n`)

        return
      }

      rewritten = true

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

      if (map === undefined || pair === undefined) return

      const key = pair.key
      const end = endOf(pair)

      if (block(map) && isNode(key) && key.range != null && end !== undefined) {
        let start = lineStart(key.range[0])
        const indent = text.slice(start, key.range[0])

        while (start > 0) {
          const previous = lineStart(start - 1)
          const line = text.slice(previous, start)

          if (!line.startsWith(`${indent}#`)) break

          start = previous
        }

        splice(start, end, "")

        return
      }

      rewritten = true
      map.items.splice(map.items.indexOf(pair), 1)
    },
    rename: (from, to) => {
      const pair = pairOf(from)

      if (pair === undefined) return

      const key = pair.key

      if (block(projects()) && isNode(key) && key.range != null) {
        splice(key.range[0], key.range[1], stringify(to).trimEnd())

        return
      }

      rewritten = true

      if (isScalar(pair.key)) pair.key.value = to
      else pair.key = doc.createNode(to)
    },
  }

  return {
    edit,
    render: () => (rewritten ? doc.toString({ lineWidth: 0, flowCollectionPadding: false }) : text),
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

    // Replace YAML's LF-only position, omitting the colon that introduces its code frame.
    const yamlFailure = (cause: unknown, text?: string) => {
      const head =
        (cause instanceof Error ? cause.message : String(cause)).split(/\r\n|\r|\n/)[0] ?? ""

      const offset = cause instanceof YAMLParseError ? cause.pos?.[0] : undefined

      let message = head.replace(/( at line \d+, column \d+):$/, "$1")

      // With no LF, preserve YAML's diagnostic: all-CR parsing is not handled here.
      if (text !== undefined && text.includes("\n") && offset !== undefined) {
        const { line, col } = offsetLineCol(text, offset)

        message = head.replace(/ at line \d+, column \d+:$/, ` at line ${line}, column ${col}`)
      }

      return new RegistryError({ message: `${file}: ${message}`, cause })
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

            return { text, entries } as const
          },
          catch: (cause) => yamlFailure(cause, text),
        }),
      ),
      Effect.flatMap((result) =>
        "failed" in result
          ? Effect.fail(new RegistryError({ message: `${file}: ${result.failed}` }))
          : Effect.succeed(result),
      ),
    )

    const write = (render: () => string) =>
      Effect.try({ try: render, catch: (cause) => yamlFailure(cause) }).pipe(
        Effect.flatMap((text) =>
          Effect.try({
            try: () => {
              const doc = parseDocument(text)
              const [error] = doc.errors

              if (error !== undefined) throw error

              doc.toJS({ mapAsMap: true })

              return text
            },
            catch: (cause) => {
              // `read` accepted the file, so an unresolved alias here is the edit's doing.
              const alias = /^Unresolved alias[^\n]*: (.+)$/m.exec(
                cause instanceof Error ? cause.message : "",
              )

              return alias === null
                ? yamlFailure(cause, text)
                : new RegistryError({
                    message: `${file}: the edit would leave alias *${alias[1]} unresolved`,
                    cause,
                  })
            },
          }),
        ),
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
            const { text } = yield* read
            const editor = editOf(text)
            const result = yield* edit(editor.edit)

            yield* write(editor.render)

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
