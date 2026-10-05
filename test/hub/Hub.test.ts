import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, Exit, FileSystem, Layer, PlatformError } from "effect"
import { fsSource, Hub, SourceError } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, hubOn, md } from "./helpers.ts"

describe("Hub.layer", () => {
  effectTest(
    "dies when two sources share a kind",
    Effect.gen(function* () {
      const layer = Hub.layer({
        home: "/nowhere",
        userHome: "/nowhere",
        sources: [memorySource(), memorySource()],
      })
      const exit = yield* Effect.exit(Layer.build(layer.pipe(Layer.provide(BunServices.layer))))
      expect(Exit.hasDies(exit)).toBe(true)
    }),
  )
})

describe("sourceKinds", () => {
  effectTest(
    "lists every loaded source kind in hub order",
    Effect.gen(function* () {
      const hub = yield* hubOn([fsSource, memorySource()])
      expect(yield* hub.sourceKinds()).toEqual(["fs", "memory"])
    }),
    diskWith({}),
  )
})

describe("dashboard", () => {
  effectTest(
    "describes each project once and keeps overview rows aligned",
    Effect.gen(function* () {
      // Counted per project, not once overall: `dashboard` describes projects
      // concurrently, so which one reads its status first is not fixed.
      const statusReads = new Map<string, number>()
      const counting = memorySource({
        status: (project) => {
          const reads = (statusReads.get(project.name) ?? 0) + 1
          statusReads.set(project.name, reads)
          return Effect.succeed({ ahead: reads })
        },
      })
      const hub = yield* hubOn([counting])
      yield* hub.add({ name: "a", source: "memory", config: { title: "A" } })
      yield* hub.add({ name: "b", source: "memory", config: { title: "B" } })
      statusReads.clear()
      const snapshot = yield* hub.dashboard()
      expect([...statusReads].sort()).toEqual([
        ["a", 1],
        ["b", 1],
      ])
      expect(snapshot.projects.map((info) => [info.name, info.status])).toEqual([
        ["a", { ahead: 1, result: "never" }],
        ["b", { ahead: 1, result: "never" }],
      ])
      expect(snapshot.overview.projects.map((entry) => entry.project)).toEqual([
        ...snapshot.projects,
      ])
    }),
    diskWith({}),
  )

  effectTest(
    "lists from the snapshotted project when the registry changes mid-request",
    Effect.gen(function* () {
      const snapYaml = md(
        "projects:",
        "  a:",
        "    source: memory",
        "    title: SnapTitle",
        "    tasks:",
        "      - title: keep",
      )
      const otherYaml = md(
        "projects:",
        "  a:",
        "    source: memory",
        "    title: OtherTitle",
        "    tasks:",
        "      - title: gone",
      )
      let registryReads = 0
      const hub = yield* hubOn([memorySource()], {
        wrapFs: (fs) => ({
          ...fs,
          readFileString: (path, options) => {
            if (path.endsWith("/projects.yaml")) {
              registryReads += 1
              return Effect.succeed(registryReads === 1 ? snapYaml : otherYaml)
            }
            return fs.readFileString(path, options)
          },
        }),
      })
      yield* hub.add({
        name: "a",
        source: "memory",
        config: { title: "SnapTitle", tasks: [{ title: "keep" }] },
      })
      registryReads = 0
      const snapshot = yield* hub.dashboard()
      const entry = snapshot.overview.projects[0]
      expect(entry).toBeDefined()
      if (entry === undefined || !("listing" in entry)) return
      expect(entry.listing.title).toBe("SnapTitle")
      expect(
        entry.listing.sections.flatMap((section) => section.tasks).map((view) => view.task.title),
      ).toEqual(["keep"])
    }),
    diskWith({}),
  )
})

describe("projects", () => {
  effectTest(
    "an empty home has no projects",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect(yield* hub.projects()).toEqual([])
    }),
    diskWith({}),
  )

  effectTest(
    "broken entries are listed with an error status while the others load",
    Effect.gen(function* () {
      const hub = yield* hubOn([fsSource, memorySource()])
      const projects = yield* hub.projects()
      expect(projects.map(({ name, location, status }) => [name, location, status])).toEqual([
        [
          "work",
          "",
          {
            result: "error",
            error: "project work uses the jira source, which is not available here",
          },
        ],
        [
          "bad",
          "",
          { result: "error", error: expect.stringContaining("project bad has an invalid config") },
        ],
        [
          "plain",
          "",
          {
            result: "error",
            error: "project plain has an invalid config: the entry needs a source",
          },
        ],
        ["ok", "memory", { result: "never" }],
      ])
      expect((yield* Effect.flip(hub.todo("work")))._tag).toBe("SourceUnavailable")
      expect((yield* Effect.flip(hub.todo("bad")))._tag).toBe("InvalidProjectConfig")
      expect((yield* (yield* hub.todo("ok")).list()).title).toBe("")
    }),
    diskWith({
      ".todo-md/projects.yaml": md(
        "projects:",
        "  work:",
        "    source: jira",
        "    site: https://acme.atlassian.net",
        "  bad:",
        "    source: fs",
        "    path: 12",
        "  plain: just text",
        "  ok:",
        "    source: memory",
      ),
    }),
  )

  effectTest(
    "entries with invalid names are listed with an error status",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      const projects = yield* hub.projects()
      const invalidName = (name: string) => ({
        result: "error" as const,
        error: `project ${name} has an invalid config: invalid project name: use lowercase letters, digits and dashes`,
      })
      expect(projects.map(({ name, status }) => [name, status])).toEqual([
        ["..", invalidName("..")],
        ["../../victim", invalidName("../../victim")],
        ["My App", invalidName("My App")],
        ["ok", { result: "never" }],
      ])
      expect((yield* Effect.flip(hub.todo("My App")))._tag).toBe("InvalidProjectConfig")
    }),
    diskWith({
      ".todo-md/projects.yaml": md(
        "projects:",
        "  ..:",
        "    source: memory",
        '  "../../victim":',
        "    source: memory",
        "  My App:",
        "    source: memory",
        "  ok:",
        "    source: memory",
      ),
    }),
  )

  effectTest(
    "an unreadable registry fails with RegistryError",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect((yield* Effect.flip(hub.projects()))._tag).toBe("RegistryError")
    }),
    diskWith({ ".todo-md/projects.yaml": "projects: [\n" }),
  )
})

describe("add", () => {
  effectTest(
    "writes the entry, creates the data directory and returns the project",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      const info = yield* hub.add({ source: "fs", config: { path: `${disk.root}/app` } })
      expect(info).toEqual({
        name: "app",
        source: "fs",
        location: `${disk.root}/app`,
        registered: true,
        syncable: false,
        status: { result: "never" },
      })
      expect(yield* disk.read(".todo-md/projects.yaml")).toBe(
        md("projects:", "  app:", "    source: fs", `    path: ${disk.root}/app`),
      )
      expect(yield* disk.exists(".todo-md/projects/app")).toBe(true)
      expect(yield* hub.projects()).toEqual([info])
    }),
    diskWith({ "app/todo/TODO.md": md("# App") }),
  )

  effectTest(
    "expands ~ for the source but writes the config as given",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      const info = yield* hub.add({ source: "fs", config: { path: "~/app" } })
      expect(info.location).toBe(`${disk.root}/app`)
      expect(yield* disk.read(".todo-md/projects.yaml")).toBe(
        md("projects:", "  app:", "    source: fs", "    path: ~/app"),
      )
    }),
    diskWith({ "app/TODO.md": md("# App") }),
  )

  effectTest(
    "rejects invalid, taken and missing names",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      const invalid = yield* Effect.flip(hub.add({ name: "My App", source: "memory", config: {} }))
      expect(invalid._tag).toBe("RegistryError")
      expect(invalid.message).toContain("invalid project name My App")
      yield* hub.add({ name: "app", source: "memory", config: {} })
      const taken = yield* Effect.flip(hub.add({ name: "app", source: "memory", config: {} }))
      expect(taken.message).toBe("a project named app already exists")
      const unnamed = yield* Effect.flip(hub.add({ source: "memory", config: {} }))
      expect(unnamed.message).toBe("a name is required")
      expect((yield* hub.projects()).map((project) => project.name)).toEqual(["app"])
    }),
    diskWith({}),
  )

  effectTest(
    "rejects an unknown source and a config its source rejects",
    Effect.gen(function* () {
      const hub = yield* hubOn([fsSource])
      const unknown = yield* Effect.flip(hub.add({ name: "w", source: "jira", config: {} }))
      expect(unknown._tag).toBe("SourceUnavailable")
      const relative = yield* Effect.flip(hub.add({ source: "fs", config: { path: "app" } }))
      expect(relative._tag).toBe("InvalidProjectConfig")
      expect(relative.message).toContain("must be an absolute path")
      const notAMap = yield* Effect.flip(hub.add({ name: "x", source: "fs", config: "app" }))
      expect(notAMap._tag).toBe("InvalidProjectConfig")
    }),
    diskWith({}),
  )

  effectTest(
    "runs prepare in the new data directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      const source = memorySource({
        prepare: (project) =>
          Effect.flatMap(FileSystem.FileSystem, (fs) =>
            fs.writeFileString(`${project.dir}/marker`, project.name),
          ).pipe(Effect.orDie),
      })
      const hub = yield* hubOn([source])
      yield* hub.add({ name: "x", source: "memory", config: {} })
      expect(yield* disk.read(".todo-md/projects/x/marker")).toBe("x")
    }),
    diskWith({}),
  )

  effectTest(
    "a failing prepare leaves neither the entry nor the directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      const source = memorySource({
        prepare: (project) => Effect.fail(new SourceError({ name: project.name, message: "no" })),
      })
      const hub = yield* hubOn([source])
      const error = yield* Effect.flip(hub.add({ name: "x", source: "memory", config: {} }))
      expect(error).toBeInstanceOf(SourceError)
      expect(yield* hub.projects()).toEqual([])
      expect(yield* disk.exists(".todo-md/projects/x")).toBe(false)
    }),
    diskWith({}),
  )

  effectTest(
    "refuses a leftover data directory without deleting it",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* disk.write(".todo-md/projects/x/keep", "keep")
      const hub = yield* hubOn([memorySource()])
      const error = yield* Effect.flip(hub.add({ name: "x", source: "memory", config: {} }))
      expect(error._tag).toBe("RegistryError")
      expect(error.message).toContain("already exists")
      expect(yield* disk.exists(".todo-md/projects/x/keep")).toBe(true)
      expect(yield* hub.projects()).toEqual([])
    }),
    diskWith({}),
  )

  effectTest(
    "registering an open list under another name replaces its unregistered entry",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])
      const opened = yield* hub.resolve({ dir: `${root}/lists/acme`, cwd: root })
      expect(opened.registered).toBe(false)
      expect((yield* hub.projects()).map((info) => info.name)).toEqual([opened.name])

      yield* hub.add({ name: "work", source: "fs", config: { path: `${root}/lists/acme` } })

      const after = yield* hub.projects()
      expect(after.map((info) => info.name)).toEqual(["work"])
      expect(after[0]?.registered).toBe(true)
    }),
    diskWith({ "lists/acme/TODO.md": md("# Acme") }),
  )
})

test("concurrent adds of one name keep the winner's directory", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const [one, two] = [
        yield* hubOn([
          memorySource({
            prepare: (project) =>
              Effect.flatMap(FileSystem.FileSystem, (fs) =>
                fs.writeFileString(`${project.dir}/marker`, project.name),
              ).pipe(Effect.orDie, Effect.andThen(Effect.sleep("50 millis"))),
          }),
        ]),
        yield* hubOn([
          memorySource({
            prepare: (project) =>
              Effect.flatMap(FileSystem.FileSystem, (fs) =>
                fs.writeFileString(`${project.dir}/marker`, project.name),
              ).pipe(Effect.orDie, Effect.andThen(Effect.sleep("50 millis"))),
          }),
        ]),
      ]
      const results = yield* Effect.all(
        [one, two].map((hub) => Effect.exit(hub.add({ name: "x", source: "memory", config: {} }))),
        { concurrency: "unbounded" },
      )
      expect(results.filter(Exit.isSuccess)).toHaveLength(1)
      const projects = yield* one.projects()
      expect(projects.map((project) => project.name)).toEqual(["x"])
      const disk = yield* Disk
      expect(yield* disk.exists(".todo-md/projects/x/marker")).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(diskWith({}))),
  ))

describe("remove", () => {
  effectTest(
    "a refusing beforeRemove keeps the entry and the directory, unless forced",
    Effect.gen(function* () {
      const disk = yield* Disk
      const source = memorySource({
        beforeRemove: (project, force) =>
          force
            ? Effect.void
            : Effect.fail(new SourceError({ name: project.name, message: "ahead 1" })),
      })
      const hub = yield* hubOn([source])
      yield* hub.add({ name: "x", source: "memory", config: {} })
      const error = yield* Effect.flip(hub.remove("x"))
      expect(error.message).toBe("ahead 1")
      expect((yield* hub.projects()).map((project) => project.name)).toEqual(["x"])
      expect(yield* disk.exists(".todo-md/projects/x")).toBe(true)
      yield* hub.remove("x", { force: true })
      expect(yield* hub.projects()).toEqual([])
      expect(yield* disk.exists(".todo-md/projects/x")).toBe(false)
    }),
    diskWith({}),
  )

  effectTest(
    "removes a broken entry, and fails for an unknown one",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      yield* hub.remove("work")
      expect(yield* hub.projects()).toEqual([])
      expect((yield* Effect.flip(hub.remove("nope")))._tag).toBe("ProjectNotFound")
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects:", "  work:", "    source: jira") }),
  )

  effectTest(
    "will not delete a broken entry's data unasked: no source can be asked about it",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource()])
      const error = yield* Effect.flip(hub.remove("work"))
      expect(error._tag).toBe("SourceError")
      expect(error.message).toContain("use --force")
      expect(yield* disk.exists(".todo-md/projects/work/clone/TODO.md")).toBe(true)
      yield* hub.remove("work", { force: true })
      expect(yield* hub.projects()).toEqual([])
      expect(yield* disk.exists(".todo-md/projects/work")).toBe(false)
    }),
    diskWith({
      ".todo-md/projects.yaml": md("projects:", "  work:", "    source: git"),
      ".todo-md/projects/work/clone/TODO.md": md("# Work"),
    }),
  )

  effectTest(
    "drops the cached project",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({ name: "x", source: "memory", config: {} })
      yield* hub.todo("x")
      yield* hub.remove("x")
      expect((yield* Effect.flip(hub.todo("x")))._tag).toBe("ProjectNotFound")
    }),
    diskWith({}),
  )

  effectTest(
    "an entry with an invalid name loses only its entry, never a directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* disk.write("victim/keep", "keep")
      const hub = yield* hubOn([memorySource()])
      yield* hub.remove("../../victim")
      yield* hub.remove("..")
      expect(yield* hub.projects()).toEqual([])
      expect(yield* disk.read("victim/keep")).toBe("keep")
      expect(yield* disk.exists(".todo-md/projects.yaml")).toBe(true)
    }),
    diskWith({
      ".todo-md/projects.yaml": md(
        "projects:",
        "  ..:",
        "    source: memory",
        '  "../../victim":',
        "    source: memory",
      ),
    }),
  )

  effectTest(
    "moves the data directory aside before the registry is written, then deletes it",
    Effect.gen(function* () {
      const disk = yield* Disk
      // Whether projects/x exists at each write of projects.yaml.
      const seen: Array<boolean> = []
      const hub = yield* hubOn([memorySource()], {
        wrapFs: (fs) => ({
          ...fs,
          rename: (from, to) =>
            to.endsWith("/projects.yaml")
              ? fs.exists(`${disk.root}/.todo-md/projects/x`).pipe(
                  Effect.tap((exists) => Effect.sync(() => seen.push(exists))),
                  Effect.andThen(fs.rename(from, to)),
                )
              : fs.rename(from, to),
        }),
      })
      yield* hub.add({ name: "x", source: "memory", config: {} })
      yield* disk.write(".todo-md/projects/x/marker", "x")
      yield* hub.remove("x")
      expect(seen).toEqual([true, false])
      expect(yield* disk.tree()).toEqual([".todo-md/projects.yaml"])
    }),
    diskWith({}),
  )

  effectTest(
    "a data directory that cannot be deleted is named, and the entry stays removed",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource()], {
        wrapFs: (fs) => ({
          ...fs,
          remove: (path, options) =>
            path.includes("/.removed-")
              ? Effect.fail(
                  PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "remove",
                    pathOrDescriptor: path,
                  }),
                )
              : fs.remove(path, options),
        }),
      })
      yield* hub.add({ name: "x", source: "memory", config: {} })
      yield* disk.write(".todo-md/projects/x/marker", "x")
      const error = yield* Effect.flip(hub.remove("x"))
      expect(error._tag).toBe("RegistryError")
      expect(error.message).toContain(`${disk.root}/.todo-md/projects/.removed-x-`)
      expect(error.message).toContain("the entry x is removed")
      expect(yield* hub.projects()).toEqual([])
      expect(yield* disk.exists(".todo-md/projects/x")).toBe(false)
      expect(
        (yield* disk.tree()).filter((file) => file.startsWith(".todo-md/projects/.removed-x-")),
      ).toHaveLength(1)
    }),
    diskWith({}),
  )

  effectTest(
    "a failing registry write keeps the entry and puts the data directory back",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({ name: "x", source: "memory", config: {} })
      yield* disk.write(".todo-md/projects/x/marker", "x")
      // A directory where the registry writes its temporary file makes the write fail.
      yield* disk.write(".todo-md/projects.yaml.tmp/blocker", "")
      expect((yield* Effect.flip(hub.remove("x")))._tag).toBe("RegistryError")
      expect((yield* hub.projects()).map((project) => project.name)).toEqual(["x"])
      expect(yield* disk.tree()).toEqual([
        ".todo-md/projects.yaml",
        ".todo-md/projects.yaml.tmp/blocker",
        ".todo-md/projects/x/marker",
      ])
    }),
    diskWith({}),
  )
})

describe("rename", () => {
  effectTest(
    "moves the entry, the data directory and the cached project",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({ name: "old", source: "memory", config: {} })
      yield* disk.write(".todo-md/projects/old/marker", "kept")
      yield* hub.todo("old")
      const info = yield* hub.rename("old", "new")
      expect(info.name).toBe("new")
      expect(yield* disk.read(".todo-md/projects/new/marker")).toBe("kept")
      expect(yield* disk.exists(".todo-md/projects/old")).toBe(false)
      expect((yield* Effect.flip(hub.todo("old")))._tag).toBe("ProjectNotFound")
      yield* hub.todo("new")
    }),
    diskWith({}),
  )

  effectTest(
    "refuses an unknown project, an invalid name and a taken name",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({ name: "a", source: "memory", config: {} })
      yield* hub.add({ name: "b", source: "memory", config: {} })
      expect((yield* Effect.flip(hub.rename("zzz", "c")))._tag).toBe("ProjectNotFound")
      expect((yield* Effect.flip(hub.rename("a", "B!"))).message).toContain("invalid project name")
      expect((yield* Effect.flip(hub.rename("a", "b"))).message).toBe(
        "a project named b already exists",
      )
      expect((yield* hub.projects()).map((project) => project.name)).toEqual(["a", "b"])
    }),
    diskWith({}),
  )

  effectTest(
    "refuses a leftover target directory without touching either directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({ name: "a", source: "memory", config: {} })
      yield* disk.write(".todo-md/projects/a/marker", "a")
      yield* disk.write(".todo-md/projects/b/keep", "keep")
      const error = yield* Effect.flip(hub.rename("a", "b"))
      expect(error._tag).toBe("RegistryError")
      expect(error.message).toBe(
        `${disk.root}/.todo-md/projects/b already exists; remove it or choose another name`,
      )
      expect((yield* hub.projects()).map((project) => project.name)).toEqual(["a"])
      expect(yield* disk.read(".todo-md/projects/a/marker")).toBe("a")
      expect(yield* disk.read(".todo-md/projects/b/keep")).toBe("keep")
    }),
    diskWith({}),
  )

  effectTest(
    "repairs an entry with an invalid name without moving any directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* disk.write("victim/keep", "keep")
      const hub = yield* hubOn([memorySource()])
      const info = yield* hub.rename("../../victim", "fixed")
      expect(info).toMatchObject({ name: "fixed", status: { result: "never" } })
      expect(yield* disk.read("victim/keep")).toBe("keep")
      expect(yield* disk.exists(".todo-md/projects/fixed")).toBe(false)
      expect((yield* hub.projects()).map((project) => project.name)).toEqual(["fixed"])
      yield* hub.todo("fixed")
    }),
    diskWith({
      ".todo-md/projects.yaml": md("projects:", '  "../../victim":', "    source: memory"),
    }),
  )
})

describe("todo", () => {
  effectTest(
    "evaluates cross-project dependencies across registered projects",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({ name: "upstream", source: "memory", config: {} })
      yield* hub.add({ name: "downstream", source: "memory", config: {} })
      const upstream = yield* hub.todo("upstream")
      const downstream = yield* hub.todo("downstream")

      const t1 = yield* upstream.add({ title: "Upstream task" })
      const t2 = yield* downstream.add({
        title: "Downstream task",
        dependsOn: [`upstream:${t1.id}`],
      })

      const nextBefore = yield* downstream.next()
      expect(nextBefore.some((v) => v.task.id === t2.id)).toBe(false)

      yield* upstream.complete(t1.id)
      const nextAfter = yield* downstream.next()
      expect(nextAfter.some((v) => v.task.id === t2.id)).toBe(true)
    }),
    diskWith({}),
  )
  effectTest(
    "returns services over the same store each time",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({
        name: "m",
        source: "memory",
        config: { title: "Memory", tasks: [{ title: "Seeded" }] },
      })
      yield* (yield* hub.todo("m")).add({ title: "Added" })
      const listing = yield* (yield* hub.todo("m")).list()
      expect(listing.title).toBe("Memory")
      expect(listing.sections[0]?.tasks.map((view) => view.task.title)).toEqual(["Seeded", "Added"])
    }),
    diskWith({}),
  )

  effectTest(
    "reaches a registered fs list on disk",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      yield* hub.add({ name: "app", source: "fs", config: { path: `${disk.root}/app` } })
      const todo = yield* hub.todo("app")
      yield* todo.add({ title: "Ship it" })
      expect(yield* disk.read("app/todo/TODO.md")).toBe(md("# App", "", "- [ ] 01 - Ship it"))
      expect((yield* todo.next()).map((view) => view.task.title)).toEqual(["Ship it"])
    }),
    diskWith({ "app/todo/TODO.md": md("# App") }),
  )

  effectTest(
    "fails with SourceError for a missing list, and retries once it exists",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      yield* hub.add({ name: "app", source: "fs", config: { path: `${disk.root}/app` } })
      const error = yield* Effect.flip(hub.todo("app"))
      expect(error.message).toBe(`no TODO.md at ${disk.root}/app`)
      yield* disk.write("app/TODO.md", md("# App"))
      expect((yield* (yield* hub.todo("app")).list()).title).toBe("App")
    }),
    diskWith({}),
  )

  effectTest(
    "fails with ProjectNotFound for an unknown name",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect(yield* Effect.flip(hub.todo("nope"))).toMatchObject({
        _tag: "ProjectNotFound",
        name: "nope",
      })
    }),
    diskWith({}),
  )

  effectTest(
    "rebuilds a project's service when its entry changes on disk",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      expect((yield* (yield* hub.todo("app")).list()).title).toBe("A")
      yield* disk.write(
        ".todo-md/projects.yaml",
        md("projects:", "  app:", "    source: fs", "    path: ~/b"),
      )
      expect((yield* (yield* hub.todo("app")).list()).title).toBe("B")
    }),
    diskWith({
      "a/TODO.md": md("# A"),
      "b/TODO.md": md("# B"),
      ".todo-md/projects.yaml": md("projects:", "  app:", "    source: fs", "    path: ~/a"),
    }),
  )

  effectTest(
    "fails with ProjectNotFound once its entry is removed on disk",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource()])
      yield* hub.todo("m")
      yield* disk.write(".todo-md/projects.yaml", md("projects:"))
      expect((yield* Effect.flip(hub.todo("m")))._tag).toBe("ProjectNotFound")
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects:", "  m:", "    source: memory") }),
  )
})

// Real clock: the registry lock retries with sleeps.
test("concurrent adds from two hubs over one home both land", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const [one, two] = [yield* hubOn([memorySource()]), yield* hubOn([memorySource()])]
      yield* Effect.all(
        Array.from({ length: 10 }, (_, i) =>
          (i % 2 === 0 ? one : two).add({ name: `p${i}`, source: "memory", config: {} }),
        ),
        { concurrency: "unbounded" },
      )
      const names = (yield* one.projects()).map((project) => project.name).sort()
      expect(names).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"])
    }).pipe(Effect.scoped, Effect.provide(diskWith({}))),
  ))
