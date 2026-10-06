import { describe, expect, test } from "bun:test"
import { jiraIdOf, planPull } from "../../src/jira/pull.ts"
import type { Task } from "../../src/spec/index.ts"

const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  title: id,
  description: "",
  status: "open",
  tags: [],
  dependsOn: [],
  comments: [],
  extra: {},
  ...fields,
})

/** A local task pulled from `key`. */
const linked = (id: string, key: string, fields: Partial<Task> = {}) =>
  task(id, { title: key, ...fields, extra: { jira_id: key, ...fields.extra } })

/** An issue as the mapping makes it: its key is its ID. */
const issue = (key: string, fields: Partial<Task> = {}) => task(key, fields)

describe("jiraIdOf", () => {
  test("reads the key from extra.jira_id", () => {
    expect(jiraIdOf(linked("1", "PROJ-1"))).toBe("PROJ-1")
  })

  test("ignores a task with no key, or one that is not text", () => {
    expect(jiraIdOf(task("1"))).toBeUndefined()
    expect(jiraIdOf(task("1", { extra: { jira_id: 12 } }))).toBeUndefined()
    expect(jiraIdOf(task("1", { extra: { jira_id: " " } }))).toBeUndefined()
  })
})

describe("planPull", () => {
  test("adds an open issue with no task, linked by jira_id", () => {
    const plan = planPull(
      [],
      [
        issue("PROJ-1", {
          title: "Rework auth",
          description: "Tokens expire.",
          tags: ["auth"],
          assignee: "ana",
        }),
      ],
    )

    expect(plan).toEqual({
      changes: [
        {
          kind: "add",
          key: "PROJ-1",
          input: {
            title: "Rework auth",
            description: "Tokens expire.",
            tags: ["auth"],
            assignee: "ana",
            extra: { jira_id: "PROJ-1" },
          },
        },
      ],
      missing: [],
    })
  })

  test("never adds a done issue", () => {
    expect(planPull([], [issue("PROJ-1", { status: "done" })]).changes).toEqual([])
  })

  test("changes nothing when the task already matches its issue", () => {
    const local = [linked("4", "PROJ-1", { title: "Same", description: "Text.\n" })]

    expect(planPull(local, [issue("PROJ-1", { title: "Same", description: "Text." })])).toEqual({
      changes: [],
      missing: [],
    })
  })

  test("patches the title, description and assignee to follow Jira", () => {
    const local = [linked("4", "PROJ-1", { title: "Old", description: "Old.", assignee: "bo" })]
    const plan = planPull(local, [issue("PROJ-1", { title: "New", description: "New." })])

    expect(plan.changes).toEqual([
      {
        kind: "update",
        key: "PROJ-1",
        id: "4",
        patch: { title: "New", description: "New.", assignee: null },
      },
    ])
  })

  test("adds labels and blockers, keeping the tags and dependencies given here", () => {
    const local = [
      linked("4", "PROJ-1", { tags: ["mine"], dependsOn: ["9"] }),
      linked("5", "PROJ-2"),
      task("9"),
    ]

    const plan = planPull(local, [
      issue("PROJ-1", { tags: ["mine", "api"], dependsOn: ["PROJ-2", "OTHER-1"] }),
      issue("PROJ-2"),
    ])

    expect(plan.changes).toEqual([
      {
        kind: "update",
        key: "PROJ-1",
        id: "4",
        patch: { tags: ["mine", "api"], dependsOn: ["9", "5"] },
      },
    ])
  })

  test("links a new task to blockers that already have a task", () => {
    const plan = planPull([linked("5", "PROJ-2")], [issue("PROJ-1", { dependsOn: ["PROJ-2"] })])

    expect(plan.changes[0]).toMatchObject({ kind: "add", input: { dependsOn: ["5"] } })
  })

  test("completes a task whose issue is done, after patching it", () => {
    const local = [linked("4", "PROJ-1")]
    const plan = planPull(local, [issue("PROJ-1", { title: "Shipped", status: "done" })])

    expect(plan.changes.map((change) => change.kind)).toEqual(["update", "complete"])
  })

  test("reopens a completed task whose issue is open, but not a cancelled one", () => {
    const local = [
      linked("4", "PROJ-1", { status: "done" }),
      linked("5", "PROJ-2", { status: "done", outcome: "cancelled" }),
    ]

    const plan = planPull(local, [issue("PROJ-1"), issue("PROJ-2")])

    expect(plan.changes).toEqual([{ kind: "reopen", key: "PROJ-1", id: "4" }])
  })

  test("reports a looked-up key Jira did not return as missing", () => {
    const local = [linked("4", "PROJ-1"), linked("5", "PROJ-2")]
    const plan = planPull(local, [issue("PROJ-2")], ["PROJ-1", "PROJ-2"])

    expect(plan).toEqual({ changes: [], missing: ["PROJ-1"] })
  })

  test("leaves tasks with no jira_id alone, even with an issue's title", () => {
    const plan = planPull([task("1", { title: "Rework auth" })], [issue("PROJ-1")])

    expect(plan.changes).toMatchObject([{ kind: "add", key: "PROJ-1" }])
  })
})
