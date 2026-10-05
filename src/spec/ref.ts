/** A task reference as typed: `<project>:<id>`, or a bare ID in the current project. */
export interface TaskRef {
  readonly project?: string
  readonly id: string
}

/** Project names: lowercase letters, digits and dashes, starting with a letter or digit. */
export const isValidName = (name: string): boolean => /^[a-z0-9][a-z0-9-]*$/.test(name)

/** `<project>:<id>`, e.g. `todo-md:12` or `work:PROJ-7`. */
export const formatRef = (project: string, id: string): string => `${project}:${id}`

/**
 * Splits `text` at its first `:` when the left side is a valid project name
 * and the right side is not empty; otherwise all of `text` is the ID. IDs are
 * returned unchanged (callers normalize them, e.g. fs's leading zeros).
 */
export const parseRef = (text: string): TaskRef => {
  const colon = text.indexOf(":")
  const project = text.slice(0, colon)
  const id = text.slice(colon + 1)

  return colon > 0 && isValidName(project) && id !== "" ? { project, id } : { id: text }
}
