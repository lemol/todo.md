import { Effect, Option, Predicate, Schema } from "effect"
import { InvalidProjectConfig, SourceUnavailable } from "./errors.ts"
import { isValidName } from "./names.ts"
import type { RegistryEntry } from "./registry.ts"
import type { AnySource, ProjectInfo, ProjectStatus, SourceProject } from "./Source.ts"

/** A project's config: decoded by its source, or why it cannot be used. */
export type ProjectConfig =
  | { readonly _tag: "Valid"; readonly source: AnySource; readonly value: unknown }
  | { readonly _tag: "Invalid"; readonly problem: InvalidProjectConfig | SourceUnavailable }

/** A project as the hub keeps it: a registry entry, or an unregistered list opened in this hub. */
export interface Project {
  readonly name: string
  /** The source kind the project names; empty when its entry names none. */
  readonly kind: string
  readonly registered: boolean
  /** `<home>/projects/<name>` for registered projects with a valid name. */
  readonly dir: string | undefined
  readonly config: ProjectConfig
}

const Fields = Schema.Record(Schema.String, Schema.Unknown)

/** `~` or `~/…` at the start of a top-level string value expands to `userHome`. */
export const expandHome = (
  fields: Readonly<Record<string, unknown>>,
  userHome: string,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      Predicate.isString(value) && (value === "~" || value.startsWith("~/"))
        ? `${userHome}${value.slice(1)}`
        : value,
    ]),
  )

const withoutSource = (fields: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "source"))

/** The config fields of an `add` input: a map, without `source`. */
export const fieldsOf = (
  name: string,
  value: unknown,
): Effect.Effect<Record<string, unknown>, InvalidProjectConfig> =>
  Schema.decodeUnknownEffect(Fields)(value).pipe(
    Effect.mapError(() => new InvalidProjectConfig({ name, issues: ["expected a map of fields"] })),
    Effect.map(withoutSource),
  )

/** Decodes a project's fields (after `~` expansion) with its source's schema. */
export const decodeConfig = (
  source: AnySource,
  name: string,
  fields: Readonly<Record<string, unknown>>,
  userHome: string,
): Effect.Effect<unknown, InvalidProjectConfig> =>
  Schema.decodeUnknownEffect(source.config)(expandHome(fields, userHome)).pipe(
    Effect.mapError((error) => new InvalidProjectConfig({ name, issues: [error.message] })),
  )

const invalid = (problem: InvalidProjectConfig | SourceUnavailable): ProjectConfig => ({
  _tag: "Invalid",
  problem,
})

/**
 * A registry entry as a project. Never fails: an unusable entry keeps its
 * problem. `dirOf` is called only for a valid name; an invalid one has no
 * data directory.
 */
export const registeredProject = (
  entry: RegistryEntry,
  sources: ReadonlyMap<string, AnySource>,
  dirOf: (name: string) => string,
  userHome: string,
): Effect.Effect<Project> =>
  Effect.gen(function* () {
    const { name } = entry
    const fields = yield* Effect.option(Schema.decodeUnknownEffect(Fields)(entry.value))
    const kind = Option.getOrUndefined(fields)?.source
    if (!isValidName(name)) {
      return {
        name,
        kind: Predicate.isString(kind) ? kind : "",
        registered: true,
        dir: undefined,
        config: invalid(
          new InvalidProjectConfig({
            name,
            issues: ["invalid project name: use lowercase letters, digits and dashes"],
          }),
        ),
      }
    }
    const base = { name, registered: true, dir: dirOf(name) }
    if (Option.isNone(fields) || !Predicate.isString(kind)) {
      return {
        ...base,
        kind: "",
        config: invalid(new InvalidProjectConfig({ name, issues: ["the entry needs a source"] })),
      }
    }
    const source = sources.get(kind)
    if (source === undefined) {
      return { ...base, kind, config: invalid(new SourceUnavailable({ name, source: kind })) }
    }
    const config = yield* decodeConfig(source, name, withoutSource(fields.value), userHome).pipe(
      Effect.match({
        onFailure: invalid,
        onSuccess: (value): ProjectConfig => ({ _tag: "Valid", source, value }),
      }),
    )
    return { ...base, kind, config }
  })

/** What a source is given for `project`. */
export const sourceProjectOf = (project: Project, value: unknown): SourceProject<unknown> => ({
  name: project.name,
  config: value,
  dir: project.dir,
})

export const infoOf = (project: Project, status: ProjectStatus): ProjectInfo => {
  const { config } = project
  if (config._tag === "Invalid") {
    return {
      name: project.name,
      source: project.kind,
      location: "",
      registered: project.registered,
      syncable: false,
      status,
    }
  }
  return {
    name: project.name,
    source: project.kind,
    location: config.source.location(config.value),
    registered: project.registered,
    syncable: config.source.sync !== undefined,
    status,
  }
}

/** What a project's store is built from; it differs whenever the entry does. */
export const fingerprintOf = (project: Project): string =>
  JSON.stringify([
    project.registered,
    project.kind,
    project.dir ?? null,
    project.config._tag === "Valid" ? project.config.value : project.config.problem.message,
  ])
