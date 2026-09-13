import { BunServices } from "@effect/platform-bun"
import { Context, Effect, FileSystem, Layer, type Scope } from "effect"
import { type AnySource, Hub } from "../../src/hub/index.ts"
import { Disk } from "../fs/helpers.ts"

export { Disk, diskWith, md } from "../fs/helpers.ts"

/**
 * A hub whose home is `<disk root>/.todo-md` and whose `~` is the disk root.
 * Several hubs on one disk share a home, like separate processes. `wrapFs`
 * replaces the hub's `FileSystem`, to observe or fail its calls.
 */
export const hubOn = (
  sources: ReadonlyArray<AnySource>,
  wrapFs?: (fs: FileSystem.FileSystem) => FileSystem.FileSystem,
): Effect.Effect<Hub["Service"], never, Disk | Scope.Scope> =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const layer = Hub.layer({ home: `${root}/.todo-md`, userHome: root, sources })
    const wrapped =
      wrapFs === undefined
        ? layer
        : layer.pipe(
            Layer.provide(
              Layer.effect(FileSystem.FileSystem, Effect.map(FileSystem.FileSystem, wrapFs)),
            ),
          )
    const context = yield* Layer.build(wrapped.pipe(Layer.provide(BunServices.layer)))
    return Context.get(context, Hub)
  })
