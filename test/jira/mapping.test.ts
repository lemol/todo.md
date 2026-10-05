import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Schema } from "effect"
import { adfToMarkdown } from "../../src/jira/adf.ts"
import { Issue, markdownToAdf, slugOf, taskFromIssue } from "../../src/jira/mapping.ts"

const site = "https://acme.atlassian.net"

/** Decodes a raw Jira payload the way the client does, so the tests share its schema. */
const issueFrom = (raw: unknown) => Effect.runSync(Schema.decodeUnknownEffect(Issue)(raw))

const statuses = {
  open: { name: "In Progress", statusCategory: { key: "indeterminate", name: "In Progress" } },
  done: { name: "Done", statusCategory: { key: "done", name: "Done" } },
}

const paragraph = (value: string) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
})

const issue = (fields: Record<string, unknown> = {}, key = "PROJ-7") =>
  issueFrom({
    id: "10001",
    key,
    fields: { summary: "Rework auth", status: statuses.open, ...fields },
  })

const map = (raw: ReturnType<typeof issue>) => taskFromIssue(raw, { site })

describe("slugOf", () => {
  test("lowercases and joins runs of non-alphanumerics with a dash", () => {
    expect(slugOf("Ana Silva")).toBe("ana-silva")
    expect(slugOf("J. R. R.  Tolkien")).toBe("j-r-r-tolkien")
  })

  test("has no leading or trailing dash", () => {
    expect(slugOf("  Ana (admin) ")).toBe("ana-admin")
  })

  test("is undefined when nothing is left", () => {
    expect(slugOf("!!!")).toBeUndefined()
    expect(slugOf(undefined)).toBeUndefined()
  })
})

describe("taskFromIssue: the task itself", () => {
  test("takes the id from the key and the title from the summary", () => {
    const task = map(issue())

    expect(task.id).toBe("PROJ-7")
    expect(task.title).toBe("Rework auth")
  })

  test("falls back to the key when the summary is blank", () => {
    expect(map(issue({ summary: "   " })).title).toBe("PROJ-7")
  })

  test("keeps a summary on one line", () => {
    expect(map(issue({ summary: "Rework\nauth" })).title).toBe("Rework auth")
  })

  test("renders the description from ADF", () => {
    expect(map(issue({ description: paragraph("Tokens expire too soon.") })).description).toBe(
      "Tokens expire too soon.",
    )
  })

  test("has an empty description when the issue has none", () => {
    expect(map(issue({ description: null })).description).toBe("")
  })

  test("is open unless its status category is done", () => {
    expect(map(issue()).status).toBe("open")
    expect(map(issue({ status: statuses.done })).status).toBe("done")
  })

  test("takes tags from the labels", () => {
    expect(map(issue({ labels: ["backend", "security"] })).tags).toEqual(["backend", "security"])
  })

  test("is never in a group", () => {
    expect(map(issue()).group).toBeUndefined()
  })

  test("slugs the assignee and keeps the display name in extra", () => {
    const task = map(issue({ assignee: { accountId: "5b10a2", displayName: "Ana Silva" } }))

    expect(task.assignee).toBe("ana-silva")
    expect(task.extra.assignee_name).toBe("Ana Silva")
    expect(task.extra.assignee_account).toBe("5b10a2")
  })

  test("has no assignee when the issue is unassigned", () => {
    const task = map(issue({ assignee: null }))

    expect(task.assignee).toBeUndefined()
    expect(task.extra.assignee_name).toBeUndefined()
  })

  test("records the completion date of a done issue", () => {
    const task = map(
      issue({ status: statuses.done, resolutiondate: "2026-01-17T12:34:00.000+0000" }),
    )

    expect(task.completedAt === undefined ? undefined : DateTime.formatIso(task.completedAt)).toBe(
      "2026-01-17T12:34:00.000Z",
    )
  })

  test("ignores a resolution date on an open issue", () => {
    expect(
      map(issue({ resolutiondate: "2026-01-17T12:34:00.000+0000" })).completedAt,
    ).toBeUndefined()
  })
})

describe("taskFromIssue: dependsOn", () => {
  const link = (direction: "inwardIssue" | "outwardIssue", key: string, name = "Blocks") => ({
    id: "1",
    type: { name, inward: "is blocked by", outward: "blocks" },
    [direction]: { key, fields: { summary: key } },
  })

  test("depends on the issues that block it", () => {
    expect(map(issue({ issuelinks: [link("inwardIssue", "PROJ-1")] })).dependsOn).toEqual([
      "PROJ-1",
    ])
  })

  test("does not depend on the issues it blocks", () => {
    expect(map(issue({ issuelinks: [link("outwardIssue", "PROJ-2")] })).dependsOn).toEqual([])
  })

  test("ignores link types other than Blocks", () => {
    expect(
      map(issue({ issuelinks: [link("inwardIssue", "PROJ-3", "Relates")] })).dependsOn,
    ).toEqual([])
  })
})

describe("taskFromIssue: comments", () => {
  const comment = (author: string, created: string, body: string) => ({
    id: created,
    author: { accountId: "a", displayName: author },
    created,
    body: paragraph(body),
  })

  test("returns comments newest first, with slugged authors", () => {
    const task = map(
      issue({
        comment: {
          startAt: 0,
          maxResults: 2,
          total: 2,
          comments: [
            comment("Ana Silva", "2026-01-01T09:00:00.000+0000", "First"),
            comment("Bo Chen", "2026-01-02T09:00:00.000+0000", "Second"),
          ],
        },
      }),
    )

    expect(task.comments.map((entry) => [entry.author, entry.body])).toEqual([
      ["bo-chen", "Second"],
      ["ana-silva", "First"],
    ])
    expect(task.comments[0]?.at === undefined ? "" : DateTime.formatIso(task.comments[0].at)).toBe(
      "2026-01-02T09:00:00.000Z",
    )
  })

  test("pushes comment headings below the document's own", () => {
    const task = map(
      issue({
        comment: {
          startAt: 0,
          maxResults: 1,
          total: 1,
          comments: [
            {
              id: "1",
              author: { accountId: "a", displayName: "Ana" },
              created: "2026-01-01T09:00:00.000+0000",
              body: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "heading",
                    attrs: { level: 1 },
                    content: [{ type: "text", text: "Why" }],
                  },
                ],
              },
            },
          ],
        },
      }),
    )

    expect(task.comments[0]?.body).toBe("#### Why")
  })

  test("has no comments when the issue has none", () => {
    expect(map(issue()).comments).toEqual([])
  })
})

describe("taskFromIssue: extra", () => {
  test("carries the Jira-only fields a frontend shows", () => {
    const task = map(
      issue({
        status: statuses.open,
        priority: { name: "High" },
        project: { key: "PROJ", name: "Project" },
      }),
    )

    expect(task.extra).toEqual({
      status: "In Progress",
      priority: "High",
      url: "https://acme.atlassian.net/browse/PROJ-7",
      project: "PROJ",
    })
  })

  test("leaves out what the issue does not have", () => {
    expect(map(issue({ priority: null })).extra.priority).toBeUndefined()
  })
})

describe("Markdown to ADF", () => {
  test("makes a paragraph per block, with hard breaks between its lines", () => {
    expect(markdownToAdf("One\r\ntwo  \n\n\n \t\nThree").content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "One" },
          { type: "hardBreak" },
          { type: "text", text: "two" },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "Three" }] },
    ])
  })

  test("sends Markdown syntax as the text it is", () => {
    expect(markdownToAdf("**bold** and `code`").content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "**bold** and `code`" }] },
    ])
  })

  test("reads back as the paragraphs it was given", () => {
    expect(adfToMarkdown(markdownToAdf("First.\n\nSecond."))).toBe("First.\n\nSecond.")
  })
})
