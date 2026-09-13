import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, Option } from "effect"
import { fsSource } from "../../src/hub/index.ts"
import { listRootOf } from "../../src/hub/sources/fs.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "./helpers.ts"

const inBun = <A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>) =>
  Effect.provide(effect, BunServices.layer)

describe("fsSource", () => {
  test("names a project after its directory, skipping a trailing todo/", () => {
    expect(fsSource.defaultName?.({ path: "/code/My App" })).toBe("my-app")
    expect(fsSource.defaultName?.({ path: "/code/app/todo" })).toBe("app")
    expect(fsSource.defaultName?.({ path: "/code/app/" })).toBe("app")
    expect(fsSource.defaultName?.({ path: "/" })).toBeUndefined()
    expect(fsSource.location({ path: "/code/app" })).toBe("/code/app")
  })

  effectTest(
    "finds the list at path/todo first, then at path, without walking up",
    Effect.gen(function* () {
      const { root } = yield* Disk
      expect(yield* inBun(listRootOf(`${root}/both`))).toEqual(Option.some(`${root}/both/todo`))
      expect(yield* inBun(listRootOf(`${root}/flat`))).toEqual(Option.some(`${root}/flat`))
      expect(yield* inBun(listRootOf(`${root}/flat/src`))).toEqual(Option.none())
    }),
    diskWith({
      "both/TODO.md": md("# Outer"),
      "both/todo/TODO.md": md("# Inner"),
      "flat/TODO.md": md("# Flat"),
      "flat/src/index.ts": "",
    }),
  )

  effectTest(
    "owns the list root it opens",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const owns = (path: string, listRoot: string) =>
        inBun(fsSource.owns?.({ path }, listRoot) ?? Effect.succeed(false))
      expect(yield* owns(`${root}/both`, `${root}/both/todo`)).toBe(true)
      expect(yield* owns(`${root}/both/todo`, `${root}/both/todo`)).toBe(true)
      expect(yield* owns(`${root}/both`, `${root}/both`)).toBe(false)
      expect(yield* owns(`${root}/missing`, `${root}/missing`)).toBe(false)
    }),
    diskWith({ "both/TODO.md": md("# Outer"), "both/todo/TODO.md": md("# Inner") }),
  )
})
