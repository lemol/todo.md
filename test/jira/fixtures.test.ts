/**
 * The golden test: one realistic Jira payload, all the way to a `Task`.
 *
 * The unit tests above cover each node type on its own; this one catches the
 * things only a whole document shows, such as how the blocks space out.
 */

import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Issue, taskFromIssue } from "../../src/jira/mapping.ts"
import payload from "./fixtures/issue.json" with { type: "json" }

const task = taskFromIssue(Effect.runSync(Schema.decodeUnknownEffect(Issue)(payload)), {
  site: "https://acme.atlassian.net",
})

describe("a real Jira issue", () => {
  test("renders its description as Markdown", () => {
    expect(task.description).toBe(
      [
        "Refresh tokens expire after **15 minutes**, which logs people out mid-session. See [the incident](https://acme.atlassian.net/wiki/INC-9).",
        "",
        "## Plan",
        "",
        "1. Raise the TTL in `auth.config.ts`",
        "2. Rotate on every refresh",
        "   - Keep the old token valid for 30s",
        "",
        "> Coordinate with @Bo Chen before deploying ⚠️",
        "",
        "```typescript",
        "export const ttl = minutes(60)",
        "```",
        "",
        "| Env | TTL |",
        "| --- | --- |",
        "| prod | 60m |",
        "",
        "---",
        "",
        "- [x] Reproduce it",
        "- [ ] Ship the fix",
        "",
        "[attachment]",
      ].join("\n"),
    )
  })

  test("takes its fields from the issue", () => {
    expect({
      id: task.id,
      title: task.title,
      status: task.status,
      tags: task.tags,
      assignee: task.assignee,
      dependsOn: task.dependsOn,
      completedAt: task.completedAt,
      group: task.group,
    }).toEqual({
      id: "PROJ-42",
      title: "Rework the auth token refresh",
      status: "open",
      tags: ["backend", "security"],
      assignee: "ana-silva",
      // PROJ-40 blocks it; PROJ-50 is blocked by it, and PROJ-60 merely relates.
      dependsOn: ["PROJ-40"],
      completedAt: undefined,
      group: undefined,
    })
  })

  test("carries the Jira-only fields in extra", () => {
    expect(task.extra).toEqual({
      status: "In Progress",
      priority: "High",
      url: "https://acme.atlassian.net/browse/PROJ-42",
      project: "PROJ",
      assignee_name: "Ana Silva",
      assignee_account: "5b10a2844c20165700ede21g",
    })
  })

  test("quotes its comments newest first, below the document's own headings", () => {
    expect(task.comments).toEqual([
      {
        author: "ana-silva",
        at: expect.anything(),
        body: "> The refresh endpoint is the culprit.\n\nAgreed, on it.",
      },
      {
        author: "bo-chen",
        at: expect.anything(),
        body: "#### Findings\n\nThe refresh endpoint is the culprit.",
      },
    ])
  })
})
