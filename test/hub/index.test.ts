import { expect, test } from "bun:test"
import * as hub from "../../src/hub/index.ts"
import * as testing from "../../src/hub/testing.ts"

test("the public entry point exposes the hub, its errors, fsSource and projectInput", () => {
  expect(hub.Hub.key).toBe("@lemol/todo-md/hub/Hub")

  for (const name of [
    "ProjectNotFound",
    "NoListFound",
    "InvalidProjectConfig",
    "SourceUnavailable",
    "SourceError",
    "RegistryError",
    "SyncError",
    "fsSource",
    "FsConfig",
    "projectInput",
    "watchList",
    "isValidName",
    "formatRef",
    "parseRef",
  ]) {
    expect(hub).toHaveProperty(name)
  }

  expect(testing.memorySource().kind).toBe("memory")
})
