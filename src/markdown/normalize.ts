import type { Diagnostic, TaskId } from "../spec/index.ts"
import { isId } from "./ids.ts"
import { joinLines } from "./lines.ts"
import { allItems, type TodoFile, type TodoItem, withHead } from "./todoFile.ts"

export interface NormalizeContext {
  /** IDs used outside `TODO.md`: task and done file names (spec §2.7). */
  readonly usedIds: Iterable<TaskId>
  /** Frontmatter titles of linked task files, by root-relative path. */
  readonly titles: ReadonlyMap<string, string>
}

export interface Normalized {
  readonly text: string
  /** IDs given to items that had none, in document order. */
  readonly assigned: ReadonlyArray<TaskId>
  /** IDs of checked items, for the caller to complete. */
  readonly checked: ReadonlyArray<TaskId>
}

/**
 * The text-only steps of normalization (spec §2.11): assigns IDs to items
 * without one (step 1) and syncs link text with task file titles (step 4).
 * Finishing interrupted completions (step 2) and sweeping checked items
 * (step 3) move files, so the caller does them; `checked` lists the items.
 * Only the heads that change are rewritten.
 */
export const normalize = (todo: TodoFile, context: NormalizeContext): Normalized => {
  const items = allItems(todo)
  let currentId = 0n
  for (const id of context.usedIds) {
    if (isId(id) && BigInt(id) > currentId) currentId = BigInt(id)
  }
  for (const item of items) {
    if (item.id !== undefined && isId(item.id) && BigInt(item.id) > currentId) {
      currentId = BigInt(item.id)
    }
  }
  const assigned: TaskId[] = []
  const checked: TaskId[] = []
  let text = todo.text
  for (const item of items) {
    let id = item.id
    if (id === undefined) {
      currentId += 1n
      id = String(currentId)
      assigned.push(id)
    }
    const title =
      (item.path === undefined ? undefined : context.titles.get(item.path)) ?? item.title
    if (id !== item.id || title !== item.title) text = withHead(text, item, id, title)
    if (item.checked) checked.push(id)
  }
  return { text: joinLines(text), assigned, checked }
}

/** A `stale-link-text` diagnostic when a linked item's text differs from its file's title. */
export const staleLinkText = (item: TodoItem, title: string): Diagnostic | undefined =>
  item.linked && item.id !== undefined && item.title !== title
    ? {
        severity: "info",
        code: "stale-link-text",
        message: `link text "${item.title}" differs from the title "${title}"`,
        taskId: item.id,
        file: "TODO.md",
        line: item.start + 1,
      }
    : undefined
