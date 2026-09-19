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
  /** git: the branch to track, instead of the repository's default. */
  readonly branch?: string | undefined
  /** git: the list directory inside the repository, instead of discovering it. */
  readonly list?: string | undefined
  /** jira: the account the API token belongs to. */
  readonly email?: string | undefined
  /** jira: the environment variable holding the API token. */
  readonly tokenEnv?: string | undefined
  /** jira: a command printing the API token. */
  readonly tokenCommand?: string | undefined
  /** jira: the query behind the project, instead of "assigned to me, not done". */
  readonly jql?: string | undefined
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
 * `cwd` unless it starts with `~`. `options.source` overrides the inference,
 * and is how a target becomes a `jira` site: no URL shape says "Jira". A kind
 * this does not know gets an empty config for the frontend to fill.
 *
 * Each source's own options are left out of every other config — `branch` and
 * `list` of anything but git, `email` and the token of anything but jira — so
 * a frontend can pass them all through and then refuse the combination itself.
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
        ? {
            url: githubWithoutScheme.test(target) ? `https://${target}` : target,
            // Absent keys, not `undefined` ones: they are written to the registry.
            ...(options.branch === undefined ? {} : { branch: options.branch }),
            ...(options.list === undefined ? {} : { list: options.list }),
          }
        : source === "jira"
          ? {
              site: target.replace(/\/+$/, ""),
              ...(options.email === undefined ? {} : { email: options.email }),
              ...(options.tokenEnv === undefined ? {} : { token_env: options.tokenEnv }),
              ...(options.tokenCommand === undefined
                ? {}
                : { token_command: options.tokenCommand }),
              ...(options.jql === undefined ? {} : { jql: options.jql }),
            }
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
