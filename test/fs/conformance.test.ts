import { runConformance } from "../../src/spec/testing.ts"
import { listWith, md } from "./helpers.ts"

// Each case gets a new list in its own temporary directory, removed afterwards.
runConformance("FsTodoStore", listWith({ "TODO.md": md("# Conformance") }))
