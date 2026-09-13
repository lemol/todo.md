import { BunServices } from "@effect/platform-bun"
import { Context, Effect, Layer, type Scope } from "effect"
import { type AnySource, Hub } from "../../src/hub/index.ts"
import { Disk } from "../fs/helpers.ts"

export { Disk, diskWith, md } from "../fs/helpers.ts"

/**
 * A hub whose home is `<disk root>/.todo-md` and whose `~` is the disk root.
 * Several hubs on one disk share a home, like separate processes.
 */
export const hubOn = (
  sources: ReadonlyArray<AnySource>,
): Effect.Effect<Hub["Service"], never, Disk | Scope.Scope> =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const layer = Hub.layer({ home: `${root}/.todo-md`, userHome: root, sources })
    const context = yield* Layer.build(layer.pipe(Layer.provide(BunServices.layer)))
    return Context.get(context, Hub)
  })
