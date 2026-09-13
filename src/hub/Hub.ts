import {
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  LayerMap,
  Path,
  type PlatformError,
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
import type { AnySource, ProjectInfo, SourceEnv } from "./Source.ts"

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
    const dirOf = (name: string) => path.join(options.home, "projects", name)
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
          registeredProject(entry, sources, dirOf(entry.name), options.userHome),
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
        Effect.map(registered, (projects) => [...projects, ...unregistered.all()].map(infoOf)),

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
          return infoOf({
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
          yield* registry.update((edit) =>
            edit.has(name)
              ? Effect.sync(() => edit.delete(name))
              : Effect.fail(new ProjectNotFound({ name })),
          )
          yield* services.invalidate(name)
          const dir = dirOf(name)
          yield* fs
            .remove(dir, { recursive: true, force: true })
            .pipe(Effect.mapError(ioError(`could not remove ${dir}`)))
        }),

      rename: (from, to) =>
        Effect.gen(function* () {
          const [oldDir, newDir] = [dirOf(from), dirOf(to)]
          let moved = false
          yield* registry
            .update((edit) =>
              Effect.gen(function* () {
                if (!edit.has(from)) return yield* new ProjectNotFound({ name: from })
                if (from === to) return
                if (!isValidName(to)) return yield* nameError(to)
                if (edit.has(to)) return yield* takenError(to)
                edit.rename(from, to)
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
                moved ? Effect.ignore(fs.rename(newDir, oldDir)) : Effect.void,
              ),
            )
          unregistered.forget(to)
          yield* services.invalidate(from)
          yield* services.invalidate(to)
          return infoOf(yield* find(to))
        }),

      resolve: (at) =>
        inEnv(resolveProject(at, { registered, find, unregistered })).pipe(Effect.map(infoOf)),

      todo: (name) =>
        Effect.scoped(services.contextEffect(name)).pipe(
          Effect.map((context) => Context.get(context, TodoService)),
          // A failed build is cached like a success; drop it so the next call retries.
          Effect.tapError(() => services.invalidate(name)),
        ),
    })
  })
