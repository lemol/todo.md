import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { type ProjectInputOptions, projectInput } from "../../src/hub/index.ts"

const input = (target: string, options: Partial<ProjectInputOptions> = {}) =>
  Effect.runSync(
    projectInput(target, { cwd: "/work", ...options }).pipe(Effect.provide(BunServices.layer)),
  )

describe("projectInput", () => {
  test.each([
    ["git@github.com:lemol/mionso.git", "git", { url: "git@github.com:lemol/mionso.git" }],
    ["ssh://git@host.example/repo.git", "git", { url: "ssh://git@host.example/repo.git" }],
    [
      "https://git.example.com/team/repo.git",
      "git",
      { url: "https://git.example.com/team/repo.git" },
    ],
    ["https://github.com/lemol/mionso", "git", { url: "https://github.com/lemol/mionso" }],
    ["github.com/lemol/mionso", "git", { url: "https://github.com/lemol/mionso" }],
    ["./repos/app", "fs", { path: "/work/repos/app" }],
    ["app", "fs", { path: "/work/app" }],
    ["/srv/app", "fs", { path: "/srv/app" }],
    ["~/app", "fs", { path: "~/app" }],
  ])("%s is %s", (target, source, config) => {
    expect(input(target)).toEqual({ name: undefined, source, config })
  })

  test("an explicit source and name win", () => {
    expect(input("/srv/repo.git", { source: "git", name: "repo" })).toEqual({
      name: "repo",
      source: "git",
      config: { url: "/srv/repo.git" },
    })
    expect(input("app", { source: "fs" })).toMatchObject({ config: { path: "/work/app" } })
  })

  describe("jira", () => {
    test("makes the target the site, and passes the credentials through", () => {
      expect(
        input("https://acme.atlassian.net", {
          source: "jira",
          name: "work",
          email: "tester@acme.test",
          tokenEnv: "JIRA_TOKEN",
        }),
      ).toEqual({
        name: "work",
        source: "jira",
        config: {
          site: "https://acme.atlassian.net",
          email: "tester@acme.test",
          token_env: "JIRA_TOKEN",
        },
      })
    })

    test("writes only the keys it was given", () => {
      expect(
        input("https://acme.atlassian.net", {
          source: "jira",
          email: "tester@acme.test",
          tokenCommand: "security find-generic-password -s jira -w",
          jql: "project = PROJ",
        }).config,
      ).toEqual({
        site: "https://acme.atlassian.net",
        email: "tester@acme.test",
        token_command: "security find-generic-password -s jira -w",
        jql: "project = PROJ",
      })
    })

    test("leaves the site as typed, without a trailing slash", () => {
      expect(input("https://acme.atlassian.net/", { source: "jira" })).toMatchObject({
        config: { site: "https://acme.atlassian.net" },
      })
    })

    test("does not take git's flags", () => {
      expect(
        input("https://acme.atlassian.net", { source: "jira", branch: "main", list: "todo" })
          .config,
      ).toEqual({ site: "https://acme.atlassian.net" })
    })
  })

  test("a sqlite target is the project's name, and path its database file", () => {
    expect(input("groceries", { source: "sqlite" })).toEqual({
      name: "groceries",
      source: "sqlite",
      config: {},
    })
    expect(input("groceries", { source: "sqlite", path: "db/groceries.db" })).toEqual({
      name: "groceries",
      source: "sqlite",
      config: { path: "/work/db/groceries.db" },
    })
    expect(input("groceries", { source: "sqlite", path: "~/groceries.db", name: "food" })).toEqual({
      name: "food",
      source: "sqlite",
      config: { path: "~/groceries.db" },
    })
  })

  test("path is left out of every other source's config", () => {
    expect(input("/srv/app", { path: "/srv/app.db" }).config).toEqual({ path: "/srv/app" })
    expect(input("git@github.com:lemol/mionso.git", { path: "/srv/app.db" }).config).toEqual({
      url: "git@github.com:lemol/mionso.git",
    })
  })
})
