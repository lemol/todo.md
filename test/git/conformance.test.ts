import { runConformance } from "../../src/spec/testing.ts"
import { gitList } from "./helpers.ts"

// Each case gets its own bare remote and its own clone of it, removed
// afterwards. The store is the file-system one, so what is really under test
// is that committing and pushing never change what an operation returns.
runConformance("the git store", gitList())
