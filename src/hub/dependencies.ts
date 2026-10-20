import { Context, Effect, Layer, Option } from "effect"
import { DependencyResolver } from "../core/index.ts"
import {
  type Diagnostic,
  findCycle,
  formatRef,
  parseRef,
  type Task,
  type TaskId,
} from "../spec/index.ts"
import type { Project } from "./projects.ts"

/** Tracks in-flight foreign task resolutions to prevent recursive cycle evaluation. */
const VisitedRef = Context.Reference<ReadonlySet<string>>("@lemol/todo-md/hub/Visited", {
  defaultValue: () => new Set<string>(),
})

/** What the hub resolver needs from `Hub.ts` without importing it. */
type AnyService = any

export interface HubDeps {
  readonly find: (name: string) => Effect.Effect<Project, unknown, never>
  readonly serviceOf: (project: Project) => Effect.Effect<AnyService, unknown, never>
  readonly registered: Effect.Effect<ReadonlyArray<Project>, unknown, never>
}

const qualifiedKey = (project: string, id: string): string => formatRef(project, id)

const taskDoneCompleted = (task: Pick<Task, "status" | "outcome">): boolean =>
  task.status === "done" && task.outcome !== "cancelled"

const showTask = (service: AnyService, id: string): Effect.Effect<Task, unknown, never> => {
  const getTask =
    typeof service.get === "function"
      ? service.get(id)
      : Effect.map(
          service.show(id),
          (detail: { readonly view: { readonly task: Task } }) => detail.view.task,
        )

  return Effect.mapError(getTask, () => "missing" as const) as Effect.Effect<Task, unknown, never>
}

const showDetail = (
  service: AnyService,
  id: string,
): Effect.Effect<
  { readonly view: { readonly task: Task; readonly state: "ready" | "blocked" | "done" } },
  unknown,
  never
> =>
  Effect.mapError(service.show(id), () => "missing" as const) as Effect.Effect<
    { readonly view: { readonly task: Task; readonly state: "ready" | "blocked" | "done" } },
    unknown,
    never
  >

const listTasks = (service: AnyService): Effect.Effect<ReadonlyArray<Task>, unknown, never> =>
  Effect.mapError(service.tasks(), () => "missing" as const) as Effect.Effect<
    ReadonlyArray<Task>,
    unknown,
    never
  >

const listSections = (
  service: AnyService,
): Effect.Effect<
  { readonly sections: ReadonlyArray<{ readonly tasks: ReadonlyArray<{ readonly task: Task }> }> },
  unknown,
  never
> =>
  Effect.mapError(service.list(), () => "missing" as const) as Effect.Effect<
    {
      readonly sections: ReadonlyArray<{ readonly tasks: ReadonlyArray<{ readonly task: Task }> }>
    },
    unknown,
    never
  >

/** Builds a `DependencyResolver` layer for `currentProject` over hub projects. */
export const makeDependencyResolver = (currentProject: string, deps: HubDeps) =>
  Layer.succeed(DependencyResolver, {
    satisfied: (ids: ReadonlyArray<TaskId>) =>
      Effect.gen(function* () {
        const visited = yield* VisitedRef
        const done = new Set<TaskId>()
        const byProject = new Map<
          string,
          Array<{ readonly qualified: TaskId; readonly id: string }>
        >()

        for (const qualified of ids) {
          if (visited.has(qualified)) continue

          const ref = parseRef(qualified)

          if (ref.project === undefined) continue

          const wanted = byProject.get(ref.project) ?? []

          wanted.push({ qualified, id: ref.id })
          byProject.set(ref.project, wanted)
        }

        for (const [name, wanted] of byProject) {
          const project = yield* Effect.option(deps.find(name))

          if (project._tag === "None") continue

          const service = yield* Effect.option(deps.serviceOf(project.value))

          if (service._tag === "None") continue

          // One read of the project answers every id asked of it. A read per
          // id was a stat pass over the whole list per dependency.
          const tasks: Option.Option<ReadonlyArray<Task>> =
            typeof service.value.tasks === "function"
              ? yield* Effect.option(
                  service.value.tasks() as Effect.Effect<ReadonlyArray<Task>, unknown>,
                )
              : Option.none<ReadonlyArray<Task>>()

          if (tasks._tag === "Some") {
            const byId = new Map(tasks.value.map((task) => [task.id, task] as const))

            for (const { qualified, id } of wanted) {
              const task = byId.get(id)

              if (task !== undefined && taskDoneCompleted(task)) done.add(qualified)
            }

            continue
          }

          for (const { qualified, id } of wanted) {
            const nextVisited = new Set([...visited, qualified])
            const task = yield* Effect.option(
              Effect.provideService(showTask(service.value, id), VisitedRef, nextVisited),
            )

            if (task._tag === "None") continue

            if (taskDoneCompleted(task.value)) done.add(qualified)
          }
        }

        return done as ReadonlySet<TaskId>
      }).pipe(
        Effect.orElseSucceed(() => new Set<TaskId>() as ReadonlySet<TaskId>),
      ) as Effect.Effect<ReadonlySet<TaskId>, never, never>,

    resolve: (ids: ReadonlyArray<TaskId>) =>
      Effect.gen(function* () {
        const visited = yield* VisitedRef
        const out = new Map<
          TaskId,
          { readonly title: string | undefined; readonly state: string }
        >()

        for (const qualified of ids) {
          const ref = parseRef(qualified)

          if (ref.project === undefined) continue

          if (visited.has(qualified)) {
            out.set(qualified, { title: undefined, state: "blocked" })
            continue
          }

          const project = yield* Effect.option(deps.find(ref.project))

          if (project._tag === "None") {
            out.set(qualified, { title: undefined, state: "unknown" })
            continue
          }

          const service = yield* Effect.option(deps.serviceOf(project.value))

          if (service._tag === "None") {
            out.set(qualified, { title: undefined, state: "unknown" })
            continue
          }

          const nextVisited = new Set([...visited, qualified])
          const detail = yield* Effect.option(
            Effect.provideService(showDetail(service.value, ref.id), VisitedRef, nextVisited),
          )

          if (detail._tag === "None") {
            out.set(qualified, { title: undefined, state: "unknown" })
            continue
          }

          const task: Task = detail.value.view.task

          out.set(qualified, {
            title: task.title,
            state: task.outcome === "cancelled" ? "cancelled" : detail.value.view.state,
          })
        }

        return out
      }).pipe(Effect.orElseSucceed(() => new Map())) as Effect.Effect<
        ReadonlyMap<TaskId, { readonly title: string | undefined; readonly state: string }>,
        never,
        never
      >,

    diagnostics: (tasks: ReadonlyArray<Task>) =>
      Effect.gen(function* () {
        const diagnostics: Diagnostic[] = []

        for (const task of tasks) {
          for (const dependency of task.dependsOn) {
            const ref = parseRef(dependency)

            if (ref.project === undefined) continue

            const project = yield* Effect.option(deps.find(ref.project))

            if (project._tag === "None") {
              diagnostics.push({
                severity: "warning",
                code: "unresolvable-project",
                message: `task ${task.id} depends on unresolvable project ${ref.project}`,
                taskId: task.id,
              })
              continue
            }

            const service = yield* Effect.option(deps.serviceOf(project.value))

            if (service._tag === "None") {
              diagnostics.push({
                severity: "warning",
                code: "unresolvable-project",
                message: `task ${task.id} depends on unresolvable project ${ref.project}`,
                taskId: task.id,
              })
              continue
            }

            const found = yield* Effect.option(showTask(service.value, ref.id))

            if (found._tag === "None") {
              diagnostics.push({
                severity: "warning",
                code: "unknown-dependency",
                message: `task ${task.id} depends on unknown task ${dependency}`,
                taskId: task.id,
              })
              continue
            }

            if (found.value.outcome === "cancelled") {
              diagnostics.push({
                severity: "warning",
                code: "cancelled-dependency",
                message: `task ${task.id} depends on cancelled task ${dependency}`,
                taskId: task.id,
              })
            }
          }
        }

        const cycle = yield* findCrossProjectCycle(currentProject, tasks, deps)

        if (cycle !== undefined) diagnostics.push(cycle)

        return diagnostics as ReadonlyArray<Diagnostic>
      }).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<Diagnostic>)) as Effect.Effect<
        ReadonlyArray<Diagnostic>,
        never,
        never
      >,
  } as unknown as DependencyResolver["Service"])

const findCrossProjectCycle = (
  currentProject: string,
  tasks: ReadonlyArray<Task>,
  deps: HubDeps,
): Effect.Effect<Diagnostic | undefined, never, never> =>
  Effect.gen(function* () {
    const projects = yield* Effect.option(deps.registered)

    if (projects._tag === "None") return undefined

    const edges = new Map<string, ReadonlyArray<string>>()
    const byProject = new Map<string, ReadonlyArray<Task>>([[currentProject, tasks]])

    for (const project of projects.value) {
      if (project.name === currentProject) continue

      const service = yield* Effect.option(deps.serviceOf(project))

      if (service._tag === "None") continue

      if (typeof service.value.tasks === "function") {
        const projectTasks = yield* Effect.option(listTasks(service.value))

        if (projectTasks._tag !== "None") {
          byProject.set(project.name, projectTasks.value)
          continue
        }
      }

      const listing = yield* Effect.option(listSections(service.value))

      if (listing._tag === "None") continue

      byProject.set(
        project.name,
        listing.value.sections.flatMap(
          (section: { readonly tasks: ReadonlyArray<{ readonly task: Task }> }) =>
            section.tasks.map((view) => view.task),
        ),
      )
    }

    for (const [projectName, projectTasks] of byProject) {
      for (const task of projectTasks) {
        edges.set(
          qualifiedKey(projectName, task.id),
          task.dependsOn.map((dep) => {
            const ref = parseRef(dep)

            return ref.project === undefined
              ? qualifiedKey(projectName, ref.id)
              : qualifiedKey(ref.project, ref.id)
          }),
        )
      }
    }

    const cycle = findCycle(edges)

    if (cycle === undefined) return undefined

    const [first] = cycle

    if (first === undefined) return undefined

    const localId = (() => {
      const ref = parseRef(first)

      if (ref.project === currentProject) return ref.id

      for (const node of cycle) {
        const r = parseRef(node)

        if (r.project === currentProject) return r.id
      }

      return ref.id
    })()

    return {
      severity: "error",
      code: "dependency-cycle",
      message: `dependency cycle: ${cycle.join(" → ")}`,
      taskId: localId,
    } as Diagnostic
  }).pipe(Effect.orElseSucceed(() => undefined))
