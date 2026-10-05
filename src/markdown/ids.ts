import { formatRef, parseRef, type TaskId } from "../spec/index.ts"

const digits = /^\d+$/

/** Whether `value` is a task ID in the file-system format: decimal digits (spec §2.7). */
export const isId = (value: string): boolean => digits.test(value)

/** The model form of an ID: digits without leading zeros (`"07"` → `"7"`). */
export const parseId = (value: string): TaskId | undefined =>
  digits.test(value) ? value.replace(/^0+(?=\d)/, "") : undefined

/**
 * The model form of a dependency entry: digits (`"07"` → `"7"`) or a
 * qualified `<project>:<id>` foreign reference, whose numeric ID part is
 * normalized the same way (`"other:07"` → `"other:7"`); anything else is
 * kept unchanged.
 */
export const parseDependencyId = (value: string): TaskId | undefined => {
  const ref = parseRef(value)

  if (ref.project !== undefined) {
    const id = parseId(ref.id)

    return id !== undefined ? formatRef(ref.project, id) : value
  }

  return parseId(value)
}

/** The written form of an ID: zero-padded to at least 2 digits (`"7"` → `"07"`). */
export const formatId = (id: TaskId): string => id.padStart(2, "0")

/** One more than the largest ID in `ids` (`"1"` when there are none). */
export const nextId = (ids: Iterable<TaskId>): TaskId => {
  let max = 0n

  for (const id of ids) {
    if (digits.test(id) && BigInt(id) > max) max = BigInt(id)
  }

  return String(max + 1n)
}
