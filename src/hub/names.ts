import { isValidName } from "../spec/index.ts"

export { isValidName }

/** A valid name made from free text such as a directory name (`My App` → `my-app`); `undefined` if nothing is left. */
export const nameFrom = (text: string): string | undefined => {
  const name = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return name === "" ? undefined : name
}

/** `base`, or `base-2`, `base-3`… : the first one not in `taken`. */
export const uniqueName = (base: string, taken: ReadonlySet<string>): string => {
  let name = base

  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`

  return name
}

/** The project directory of a list path: the parent when the path ends in `/todo`. */
export const projectDirOf = (path: string): string => {
  const trimmed = path.replace(/\/+$/, "")

  return trimmed.endsWith("/todo") ? trimmed.slice(0, -"/todo".length) : trimmed
}

/** The name a list directory gives its project: its project directory's basename, as a valid name. */
export const nameForList = (path: string): string | undefined => {
  const dir = projectDirOf(path)

  return nameFrom(dir.slice(dir.lastIndexOf("/") + 1))
}
