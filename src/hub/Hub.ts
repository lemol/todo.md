import {
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  LayerMap,
  Path,
  type PlatformError,
  Random,
} from "effect"
import { TodoService } from "../core/index.ts"
import type { StoreError } from "../spec/index.ts"
import {
  type InvalidProjectConfig,
  type NoListFound,
  ProjectNotFound,
  RegistryError,
  type SourceError,
  SourceUnavailable,
} from "./errors.ts"
import type { AddInput } from "./input.ts"
import { isValidName } from "./names.ts"
import {
  decodeConfig,
  fieldsOf,
  infoOf,
  type Project,
  registeredProject,
  sourceProjectOf,
} from "./projects.ts"
import { makeRegistry } from "./registry.ts"
import { makeUnregistered, type ResolveInput, resolveProject } from "./resolve.ts"
import type { AnySource, ProjectInfo, ProjectStatus, SourceEnv } from "./Source.ts"
import { statusOf } from "./state.ts"

export interface HubOptions {
  /** The hub's directory: apps pass `$TODO_MD_HOME`, else `<userHome>/.todo-md`. */
  readonly home: string
  /** The OS user's home directory: `~` in registry values expands to it. */
  readonly userHome: string
  /** The sources this hub can open; kinds must be unique. */
  readonly sources: ReadonlyArray<AnySource>
}

/**
 * Every frontend's way to reach projects: the registry, resolution of the
 * current project, and a `TodoService` per project.
 */
export class Hub extends Context.Service<
  Hub,
  {
    /** Registered projects in registry order, then unregistered ones opened in this hub. */
    projects(): Effect.Effect<ReadonlyArray<ProjectInfo>, RegistryError>
    add(
      input: AddInput,
    ): Effect.Effect<
      ProjectInfo,
      RegistryError | InvalidProjectConfig | SourceUnavailable | SourceError
    >
    remove(
      name: string,
      options?: { readonly force?: boolean },
    ): Effect.Effect<void, ProjectNotFound | RegistryError | SourceError>
    rename(from: string, to: string): Effect.Effect<ProjectInfo, ProjectNotFound | RegistryError>
    resolve(
      at: ResolveInput,
    ): Effect.Effect<ProjectInfo, ProjectNotFound | NoListFound | RegistryError | StoreError>
    todo(
      name: string,
    ): Effect.Effect<
      TodoService["Service"],
      ProjectNotFound | InvalidProjectConfig | SourceUnavailable | SourceError | RegistryError
    >
    /** The last sync (`state.json`), overlaid with the source's live fields. Never fails for a found project. */
    status(name: string): Effect.Effect<ProjectStatus, ProjectNotFound | RegistryError>
  }
>()("@lemol/todo-md/hub/Hub") {
  /** Requires `FileSystem` and `Path`. Dies if two sources share a kind. */
  static readonly layer = (
    options: HubOptions,
  ): Layer.Layer<Hub, never, FileSystem.FileSystem | Path.Path> => Layer.effect(Hub, make(options))
}

const make = (options: HubOptions) =>
  Effect.gen(function* () {
    const env = yield* Effect.context<SourceEnv>()
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const sources = new Map<string, AnySource>()
    for (const source of options.sources) {
      if (sources.has(source.kind)) {
        return yield* Effect.die(new Error(`two sources have the kind ${source.kind}`))
      }
      sources.set(source.kind, source)
    }
    const registry = yield* makeRegistry(options.home)
    const unregistered = makeUnregistered()
    const projectsDir = path.join(options.home, "projects")
    // A defect, not an error: callers validate names first, so an escaping path is never built.
    const dirOf = (name: string) => {
      if (!isValidName(name)) throw new Error(`invalid project name ${name} has no data directory`)
      return path.join(projectsDir, name)
    }
    const inEnv = <A, E>(effect: Effect.Effect<A, E, SourceEnv>) =>
      Effect.provideContext(effect, env)
    const ioError = (message: string) => (cause: PlatformError.PlatformError) =>
      new RegistryError({ message: `${message}: ${cause.message}`, cause })
    const nameError = (name: string) =>
      new RegistryError({
        message: `invalid project name ${name}: use lowercase letters, digits and dashes`,
      })
    const takenError = (name: string) =>
      new RegistryError({ message: `a project named ${name} already exists` })

    const registered = registry.entries.pipe(
      Effect.flatMap((entries) =>
        Effect.forEach(entries, (entry) =>
          registeredProject(entry, sources, dirOf, options.userHome),
        ),
      ),
    )

    // Unregistered names never collide with registered ones when opened, so they are checked first.
    const find = (name: string): Effect.Effect<Project, ProjectNotFound | RegistryError> => {
      const open = unregistered.get(name)
      if (open !== undefined) return Effect.succeed(open)
      return registered.pipe(
        Effect.flatMap((projects) => {
          const found = projects.find((project) => project.name === name)
          return found === undefined
            ? Effect.fail(new ProjectNotFound({ name }))
            : Effect.succeed(found)
        }),
      )
    }

    const describe = (project: Project): Effect.Effect<ProjectInfo> =>
      Effect.map(inEnv(statusOf(project)), (status) => infoOf(project, status))

    const services = yield* LayerMap.make(
      (name: string) =>
        Layer.unwrap(
          Effect.gen(function* () {
            const project = yield* find(name)
            const { config } = project
            if (config._tag === "Invalid") return yield* config.problem
            const store = config.source.open(sourceProjectOf(project, config.value))
            return TodoService.layer.pipe(Layer.provide(store))
          }),
        ),
      { idleTimeToLive: Duration.infinity },
    )

    return Hub.of({
      projects: () =>
        Effect.flatMap(registered, (projects) =>
          Effect.forEach([...projects, ...unregistered.all()], describe, { concurrency: 4 }),
        ),

      add: (input) =>
        Effect.gen(function* () {
          const label = input.name ?? "(unnamed)"
          const source = sources.get(input.source)
          if (source === undefined) {
            return yield* new SourceUnavailable({ name: label, source: input.source })
          }
          const fields = yield* fieldsOf(label, input.config)
          const config = yield* decodeConfig(source, label, fields, options.userHome)
          const name = input.name ?? source.defaultName?.(config)
          if (name === undefined) {
            return yield* new RegistryError({ message: "a name is required" })
          }
          if (!isValidName(name)) return yield* nameError(name)
          if ((yield* registry.entries).some((entry) => entry.name === name)) {
            return yield* takenError(name)
          }
          const dir = dirOf(name)
          yield* fs
            .makeDirectory(path.dirname(dir), { recursive: true })
            .pipe(Effect.mapError(ioError(`could not create ${path.dirname(dir)}`)))
          yield* fs.makeDirectory(dir).pipe(
            Effect.mapError((error) =>
              error.reason._tag === "AlreadyExists"
                ? new RegistryError({
                    message: `${dir} already exists; remove it or choose another name`,
                  })
                : ioError(`could not create ${dir}`)(error),
            ),
          )
          yield* Effect.gen(function* () {
            if (source.prepare !== undefined) {
              yield* inEnv(source.prepare({ name, config, dir }))
            }
            yield* registry.update((edit) =>
              edit.has(name)
                ? Effect.fail(takenError(name))
                : Effect.sync(() => edit.add(name, { source: source.kind, ...fields })),
            )
          }).pipe(Effect.onError(() => Effect.ignore(fs.remove(dir, { recursive: true }))))
          unregistered.forget(name)
          yield* services.invalidate(name)
          return yield* describe({
            name,
            kind: source.kind,
            registered: true,
            dir,
            config: { _tag: "Valid", source, value: config },
          })
        }),

      remove: (name, options) =>
        Effect.gen(function* () {
          const project = (yield* registered).find((candidate) => candidate.name === name)
          if (project === undefined) return yield* new ProjectNotFound({ name })
          const { config } = project
          if (config._tag === "Valid" && config.source.beforeRemove !== undefined) {
            const refusal = config.source.beforeRemove(
              sourceProjectOf(project, config.value),
              options?.force === true,
            )
            yield* inEnv(refusal)
          }
          // An entry with an invalid name has no data directory.
          const { dir } = project
          let moved: string | undefined
          // Under the lock, the data directory moves aside, so a concurrent rename onto this
          // name finds it gone; names starting with `.` are never project names.
          const aside = yield* registry
            .update((edit) =>
              Effect.gen(function* () {
                if (!edit.has(name)) return yield* new ProjectNotFound({ name })
                edit.delete(name)
                if (dir === undefined) return undefined
                const move = ioError(`could not move ${dir} aside`)
                if (!(yield* fs.exists(dir).pipe(Effect.mapError(move)))) return undefined
                const token = yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER)
                const to = path.join(projectsDir, `.removed-${name}-${token.toString(36)}`)
                yield* fs.rename(dir, to).pipe(Effect.mapError(move))
                moved = to
                return to
              }),
            )
            // The entry stays if the write failed, so the directory goes back too.
            .pipe(
              Effect.onError(() =>
                moved !== undefined && dir !== undefined
                  ? Effect.ignore(fs.rename(moved, dir))
                  : Effect.void,
              ),
            )
          yield* services.invalidate(name)
          if (aside !== undefined) {
            yield* fs.remove(aside, { recursive: true }).pipe(
              Effect.mapError(
                (cause) =>
                  new RegistryError({
                    message: `the entry ${name} is removed, but its data directory, moved to ${aside}, could not be deleted: ${cause.message}`,
                    cause,
                  }),
              ),
            )
          }
        }),

      rename: (from, to) =>
        Effect.gen(function* () {
          const project = (yield* registered).find((candidate) => candidate.name === from)
          if (project === undefined) return yield* new ProjectNotFound({ name: from })
          if (!isValidName(to)) return yield* nameError(to)
          // An entry with an invalid name has no data directory: renaming it only repairs the entry.
          const oldDir = project.dir
          const newDir = dirOf(to)
          let moved = false
          yield* registry
            .update((edit) =>
              Effect.gen(function* () {
                if (!edit.has(from)) return yield* new ProjectNotFound({ name: from })
                if (from === to) return
                if (edit.has(to)) return yield* takenError(to)
                const check = ioError(`could not check ${newDir}`)
                if (yield* fs.exists(newDir).pipe(Effect.mapError(check))) {
                  return yield* new RegistryError({
                    message: `${newDir} already exists; remove it or choose another name`,
                  })
                }
                edit.rename(from, to)
                if (oldDir === undefined) return
                const move = ioError(`could not move ${oldDir}`)
                if (yield* fs.exists(oldDir).pipe(Effect.mapError(move))) {
                  yield* fs.rename(oldDir, newDir).pipe(Effect.mapError(move))
                  moved = true
                }
              }),
            )
            // The entry keeps its old name if the write failed, so the directory goes back too.
            .pipe(
              Effect.onError(() =>
                moved && oldDir !== undefined
                  ? Effect.ignore(fs.rename(newDir, oldDir))
                  : Effect.void,
              ),
            )
          unregistered.forget(to)
          yield* services.invalidate(from)
          yield* services.invalidate(to)
          return yield* describe(yield* find(to))
        }),

      resolve: (at) =>
        inEnv(resolveProject(at, { registered, find, unregistered })).pipe(
          Effect.flatMap(describe),
        ),

      todo: (name) =>
        Effect.scoped(services.contextEffect(name)).pipe(
          Effect.map((context) => Context.get(context, TodoService)),
          // A failed build is cached like a success; drop it so the next call retries.
          Effect.tapError(() => services.invalidate(name)),
        ),

      status: (name) => Effect.flatMap(find(name), (project) => inEnv(statusOf(project))),
    })
  })
