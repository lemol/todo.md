export * as GitSource from "./GitSource.ts"
export { GitConfig, gitSourceWith, repoNameOf } from "./GitSource.ts"
export { type Git, GitError, type GitOptions, makeGit } from "./git.ts"
export {
  classifyPush,
  GitState,
  gitStateFile,
  type PushFailure,
  type PushOutcome,
  readGitState,
} from "./push.ts"
