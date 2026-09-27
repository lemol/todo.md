import { runConformance } from "../../src/spec/testing.ts"
import { listWith, md } from "./helpers.ts"

// Each case gets a new list in its own temporary directory, removed afterwards.
runConformance("FsTodoStore", listWith({ "TODO.md": md("# Conformance") }))

// The same, keeping parses in a cache file: a store must behave the same with one.
runConformance(
  "FsTodoStore with a cache directory",
  listWith({ "TODO.md": md("# Conformance") }, undefined, ".cache"),
)
