import { BunServices } from "@effect/platform-bun"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { type Files, makeFiles } from "../../src/fs/files.ts"

export const md = (...lines: string[]) => `${lines.join("\n")}\n`

/** Direct access to a temporary directory's files, by root-relative path. */
export class Disk extends Context.Service<
  Disk,
  {
    readonly root: string
    read(path: string): Effect.Effect<string>
    write(path: string, text: string): Effect.Effect<void>
    exists(path: string): Effect.Effect<boolean>
    /** Sets a file's modification time. */
    setModified(path: string, time: Date): Effect.Effect<void>
    /** Every file below the root, sorted. */
    tree(): Effect.Effect<ReadonlyArray<string>>
  }
>()("test/fs/Disk") {}

/** A temporary directory holding `files` (root-relative path → text), removed afterwards. */
export const diskWith = (files: Readonly<Record<string, string>>): Layer.Layer<Disk> =>
  Layer.effect(
    Disk,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "todo-md-" }).pipe(Effect.orDie)
      const absolute = (relative: string) => path.join(root, relative)
      const disk = Disk.of({
        root,
        read: (relative) => fs.readFileString(absolute(relative)).pipe(Effect.orDie),
        write: (relative, text) =>
          fs
            .makeDirectory(path.dirname(absolute(relative)), { recursive: true })
            .pipe(Effect.andThen(fs.writeFileString(absolute(relative), text)), Effect.orDie),
        exists: (relative) => fs.exists(absolute(relative)).pipe(Effect.orDie),
        setModified: (relative, time) =>
          fs.utimes(absolute(relative), time, time).pipe(Effect.orDie),
        tree: () =>
          fs.readDirectory(root, { recursive: true }).pipe(
            Effect.flatMap((entries) =>
              Effect.forEach(entries, (entry) =>
                Effect.map(fs.stat(absolute(entry)), (info) =>
                  info.type === "File" ? [entry] : [],
                ),
              ),
            ),
            Effect.map((entries) => entries.flat().sort()),
            Effect.orDie,
          ),
      })
      for (const [relative, text] of Object.entries(files)) yield* disk.write(relative, text)
      return disk
    }),
  ).pipe(Layer.provide(BunServices.layer))

/** `Files` for the test directory. */
export const filesOnDisk: Effect.Effect<Files, never, Disk> = Effect.gen(function* () {
  return yield* makeFiles((yield* Disk).root).pipe(Effect.provide(BunServices.layer))
})
