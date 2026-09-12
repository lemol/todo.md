import { formatId } from "./ids.ts"

/**
 * Posix path helpers for paths relative to the list root. The markdown module
 * does no I/O, so it cannot use the platform's path module.
 */

/** Resolves `.` and `..` segments. Returns `undefined` if the path leaves the root or is absolute. */
export const normalizePath = (path: string): string | undefined => {
  if (path.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return undefined
  const segments: string[] = []
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) return undefined
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return segments.join("/")
}

export const joinPath = (...parts: ReadonlyArray<string>): string => {
  const joined = parts.filter((p) => p !== "").join("/")
  return normalizePath(joined) ?? joined
}

/** The root-relative path a link in `TODO.md` points to, or `undefined` if it leaves the root. */
export const resolveLink = (url: string): string | undefined => {
  let decoded = url
  try {
    decoded = decodeURI(url)
  } catch {
    // keep the raw URL when it is not valid percent-encoding
  }
  const path = normalizePath(decoded)
  return path === undefined || path === "" ? undefined : path
}

/** The link target writers use for a root-relative path: `./path`, in angle brackets if needed. */
export const linkTarget = (path: string): string =>
  /[\s()<>]/.test(path) ? `<./${path}>` : `./${path}`

/** The file name without directories. */
export const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1)

/** The directory part of a path (`""` for a file at the root). */
export const dirname = (path: string): string => {
  const index = path.lastIndexOf("/")
  return index === -1 ? "" : path.slice(0, index)
}

/**
 * A file-name-safe slug (spec §2.8): ASCII letters and digits, lowercase,
 * other runs replaced by `-`, at most 60 characters, cut at a `-` if possible.
 */
export const slug = (text: string, fallback: string): string => {
  const base = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (base.length <= 60) return base === "" ? fallback : base
  const cut = base.slice(0, 60)
  const boundary = base[60] === "-" ? 60 : cut.lastIndexOf("-")
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/, "")
}

export const groupSlug = (group: string): string => slug(group, "group")

/**
 * Where a writer puts a task file (spec §2.8):
 * `<dir>/<group-slug>/<id>-<title-slug>.md`, without the group directory when ungrouped.
 */
export const taskPath = (
  dir: string,
  group: string | undefined,
  id: string,
  title: string,
): string =>
  joinPath(
    dir,
    ...(group === undefined ? [] : [groupSlug(group)]),
    `${formatId(id)}-${slug(title, "task")}.md`,
  )
