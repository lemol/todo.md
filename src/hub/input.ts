import { Effect, Path } from "effect"

/** What `hub.add` takes. */
export interface AddInput {
  /** Default: the source's `defaultName` for the config. */
  readonly name?: string | undefined
  /** The source kind. */
  readonly source: string
  /** The source's config fields, before `~` expansion. */
  readonly config: unknown
}

export interface ProjectInputOptions {
  /** Resolves relative paths. */
  readonly cwd: string
  /** The source kind, instead of inferring it. */
  readonly source?: string | undefined
  readonly name?: string | undefined
}

const githubWithoutScheme = /^(www\.)?github\.com\//
const gitUrls = [
  /^[\w.-]+@[\w.-]+:/, // scp-like, e.g. git@github.com:owner/repo.git
  /^ssh:\/\//,
  /^https?:\/\/.+\.git\/?$/,
  /^https?:\/\/(www\.)?github\.com\//,
  githubWithoutScheme,
]

/**
 * Turns what a user types to add a project (a path or a URL) into `hub.add`'s
 * input. A git URL is `git`; anything else is an `fs` path, resolved against
 * `cwd` unless it starts with `~`. `options.source` overrides the inference;
 * kinds other than `fs` and `git` get an empty config for the frontend to fill.
 */
export const projectInputFrom = (
  target: string,
  options: ProjectInputOptions,
  resolve: (cwd: string, path: string) => string,
): AddInput => {
  const source = options.source ?? (gitUrls.some((pattern) => pattern.test(target)) ? "git" : "fs")
  const home = target === "~" || target.startsWith("~/")
  const config =
    source === "fs"
      ? { path: home ? target : resolve(options.cwd, target) }
      : source === "git"
        ? { url: githubWithoutScheme.test(target) ? `https://${target}` : target }
        : {}
  return { name: options.name, source, config }
}

export const projectInput = (
  target: string,
  options: ProjectInputOptions,
): Effect.Effect<AddInput, never, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    return projectInputFrom(target, options, (cwd, relative) => path.resolve(cwd, relative))
  })
