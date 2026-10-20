import { runConformance } from "../../src/spec/testing.ts"
import { freshStore } from "./helpers.ts"

// Each case gets a new database in its own temporary directory, removed afterwards.
runConformance("SqliteTodoStore", freshStore())
