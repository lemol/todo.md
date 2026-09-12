import { expect, test } from "bun:test"
import * as markdown from "../../src/markdown/index.ts"

test("the public entry point exposes parsing, editing, conversion and normalization", () => {
  for (const name of [
    "parseTodoFile",
    "insertItem",
    "removeItem",
    "replaceItem",
    "setItemHead",
    "renameSection",
    "formatTodoFile",
    "parseTaskFile",
    "formatTaskFile",
    "updateTaskFile",
    "prependComment",
    "parseMetadataLine",
    "inlineTask",
    "fileTask",
    "fitsInline",
    "normalize",
    "taskPath",
    "nextId",
  ]) {
    expect(typeof (markdown as Record<string, unknown>)[name]).toBe("function")
  }
})
