import type { Task } from "../../src/spec/index.ts"

/** A task with defaults, overridden by `fields`. */
export const task = (fields: Partial<Task> & Pick<Task, "id">): Task => ({
  title: `Task ${fields.id}`,
  description: "",
  status: "open",
  tags: [],
  assignee: undefined,
  dependsOn: [],
  comments: [],
  group: undefined,
  completedAt: undefined,
  outcome: undefined,
  cancelledReason: undefined,
  extra: {},
  ...fields,
})
