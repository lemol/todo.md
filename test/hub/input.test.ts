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
    expect(input("https://acme.atlassian.net", { source: "jira" })).toMatchObject({
      source: "jira",
      config: {},
    })
  })
})
