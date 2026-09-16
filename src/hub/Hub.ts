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
  type Scope,
  type Stream,
} from "effect"
import { TodoService } from "../core/index.ts"
import { type StoreError, TodoStore } from "../spec/index.ts"
import { type Changes, type HubChange, makeChanges, notifying, type Watched } from "./changes.ts"
import {
  type InvalidProjectConfig,
  type NoListFound,
  ProjectNotFound,
  RegistryError,
  type SourceError,
  SourceUnavailable,
  type SyncError,
} from "./errors.ts"
import type { AddInput } from "./input.ts"
import { isValidName } from "./names.ts"
import { type Overview, type OverviewQuery, overviewOf } from "./overview.ts"
import {
  decodeConfig,
  fieldsOf,
  fingerprintOf,
  infoOf,
  type Project,
  registeredProject,
  sourceProjectOf,
} from "./projects.ts"
import { makeRegistry } from "./registry.ts"
import { makeUnregistered, type ResolveInput, resolveProject } from "./resolve.ts"
import type { AnySource, ProjectInfo, ProjectStatus, SourceEnv } from "./Source.ts"
import { statusOf } from "./state.ts"
import { makeSyncer, type SyncFailure, type SyncResult } from "./sync.ts"

export interface HubOptions {
  /** The hub's directory: apps pass `$TODO_MD_HOME`, else `<userHome>/.todo-md`. */
  readonly home: string
  /** The OS user's home directory: `~` in registry values expands to it. */
  readonly userHome: string
  /** The sources this hub can open; kinds must be unique. */
  readonly sources: ReadonlyArray<AnySource>
  /**
   * Runs `syncAll` this often, starting one interval after the hub starts,
   * until the layer's scope closes. Off by default; for long-running hosts.
   */
  readonly autoSync?: Duration.Input
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
    /** Syncs one project; in this hub, one sync per project runs at a time. */
    sync(
      name: string,
    ): Effect.Effect<
      SyncResult,
      ProjectNotFound | InvalidProjectConfig | SourceUnavailable | RegistryError | SyncError
    >
    /** Syncs every registered project whose source can sync, four at a time. Fails only for an unreadable registry. */
    syncAll(): Effect.Effect<ReadonlyArray<SyncResult | SyncFailure>, RegistryError>
    /** `list(filter)` across projects, four at a time; a failing project is an error entry. */
    overview(query?: OverviewQuery): Effect.Effect<Overview, RegistryError>
    /** Project, sync and registry changes. Watchers run only while something consumes it. */
    readonly changes: Stream.Stream<HubChange>
    /** Acquires the change subscription and starts source watchers before returning. */
    readonly subscribeChanges: Effect.Effect<Stream.Stream<HubChange>, never, Scope.Scope>
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

    // The fingerprint of the entry each cached service was built from.
    const built = new Map<string, string>()

    const watched = Effect.map(registered, (projects) =>
      [...projects, ...unregistered.all()].flatMap((project): ReadonlyArray<Watched> => {
        const { config } = project
        if (config._tag === "Invalid" || config.source.changes === undefined) return []
        const stream = config.source.changes(sourceProjectOf(project, config.value))
        return [{ name: project.name, key: fingerprintOf(project), changes: stream }]
      }),
    )
    const changes: Changes = yield* makeChanges({
      home: options.home,
      watched,
      onRegistryFile: Effect.suspend(() => refreshServices),
    })
    const registryChanged = Effect.andThen(changes.reconcile, changes.publish({ kind: "registry" }))

    const services = yield* LayerMap.make(
      (name: string) =>
        Layer.unwrap(
          Effect.gen(function* () {
            const project = yield* find(name)
            const { config } = project
            if (config._tag === "Invalid") return yield* config.problem
            const opened = config.source.open(sourceProjectOf(project, config.value))
            // Sources with `changes` report every change themselves; for the others, the hub
            // reports its own mutations.
            const store =
              config.source.changes !== undefined
                ? opened
                : Layer.effect(
                    TodoStore,
                    Effect.map(TodoStore, (store) =>
                      notifying(store, changes.publish({ kind: "changed", project: name })),
                    ),
                  ).pipe(Layer.provide(opened))
            return Layer.fresh(TodoService.layer).pipe(Layer.provide(store))
          }),
        ),
      { idleTimeToLive: Duration.infinity },
    )

    // Drops a cached service, so its scope closes and the next `todo` builds it afresh.
    const forget = (name: string): Effect.Effect<void> =>
      Effect.andThen(
        Effect.sync(() => built.delete(name)),
        services.invalidate(name),
      )

    // Callers look the project up first, so an entry changed by another process is seen.
    const serviceOf = (project: Project) =>
      Effect.gen(function* () {
        const key = fingerprintOf(project)
        if (built.get(project.name) !== key) {
          yield* services.invalidate(project.name)
          built.set(project.name, key)
        }
        const context = yield* Effect.scoped(services.contextEffect(project.name))
        return Context.get(context, TodoService)
      }).pipe(
        // A failed build is cached like a success; drop it so the next call retries.
        Effect.tapError(() => forget(project.name)),
      )

    // Another process changed `projects.yaml`: close services built from changed or removed entries.
    const refreshServices: Effect.Effect<void> = Effect.gen(function* () {
      const current = new Map(
        (yield* registered).map((project) => [project.name, fingerprintOf(project)]),
      )
      for (const [name, key] of [...built]) {
        if (unregistered.get(name) === undefined && current.get(name) !== key) yield* forget(name)
      }
    }).pipe(
      Effect.catch((error) => Effect.logWarning(`could not refresh projects: ${error.message}`)),
    )

    const runSync = makeSyncer(changes.publish)

    const syncAll = Effect.gen(function* () {
      const syncable = (yield* registered).flatMap((project) => {
        const { config } = project
        return config._tag === "Valid" && config.source.sync !== undefined
          ? [{ project, source: config.source, value: config.value }]
          : []
      })
      return yield* Effect.forEach(
        syncable,
        ({ project, source, value }) =>
          inEnv(runSync(project, source, value)).pipe(
            Effect.catch((error) => Effect.succeed<SyncFailure>({ project: project.name, error })),
          ),
        { concurrency: 4 },
      )
    })

    if (options.autoSync !== undefined) {
      yield* Effect.sleep(options.autoSync).pipe(
        Effect.andThen(syncAll),
        Effect.catch((error) => Effect.logWarning(`autoSync: ${error.message}`)),
        Effect.forever,
        Effect.forkScoped,
      )
    }

    /**
     * A list that was open unregistered is now a registered project: drop the
     * unregistered entry whatever name it was opened under, so the same list
     * never shows up as two projects (task 14's review).
     */
    const forgetOpenList = (source: AnySource, config: unknown) => {
      const owns = source.owns
      if (owns === undefined) return Effect.void
      return Effect.forEach(
        unregistered.lists(),
        (list) =>
          Effect.flatMap(inEnv(owns(config, list)), (owned) => {
            if (!owned) return Effect.void
            const open = unregistered.byList(list)
            unregistered.forgetList(list)
            return open === undefined ? Effect.void : forget(open.name)
          }),
        { discard: true },
      )
    }

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
          yield* forgetOpenList(source, config)
          unregistered.forget(name)
          yield* forget(name)
          yield* registryChanged
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
          yield* forget(name)
          yield* registryChanged
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
          yield* forget(from)
          yield* forget(to)
          yield* registryChanged
          return yield* describe(yield* find(to))
        }),

      resolve: (at) =>
        inEnv(resolveProject(at, { registered, find, unregistered })).pipe(
          // Resolution may open an unregistered project, which is watched too.
          Effect.tap(() => changes.reconcile),
          Effect.flatMap(describe),
        ),

      todo: (name) =>
        find(name).pipe(
          Effect.flatMap(serviceOf),
          Effect.tapError(() => forget(name)),
        ),

      status: (name) => Effect.flatMap(find(name), (project) => inEnv(statusOf(project))),
      sync: (name) =>
        Effect.gen(function* () {
          const project = yield* find(name)
          const { config } = project
          if (config._tag === "Invalid") return yield* config.problem
          return yield* inEnv(runSync(project, config.source, config.value))
        }),

      syncAll: () => syncAll,
      overview: (query = {}) =>
        overviewOf(query, {
          projects: Effect.map(registered, (projects) => [...projects, ...unregistered.all()]),
          describe,
          listing: (project, filter) =>
            Effect.flatMap(serviceOf(project), (service) => service.list(filter)),
        }),
      changes: changes.stream,
      subscribeChanges: changes.subscribe,
    })
  })
