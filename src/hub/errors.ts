import { Schema } from "effect"

/** No registered project, and no unregistered project open in this hub, has this name. */
export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  name: Schema.String,
}) {
  override get message() {
    return `no project named ${this.name}`
  }
}

/** Resolution found no list by walking up from the working directory. */
export class NoListFound extends Schema.TaggedError<NoListFound>()("NoListFound", {
  cwd: Schema.String,
}) {
  override get message() {
    return `no todo.md list found from ${this.cwd}; run \`todo init\` or pass --dir`
  }
}

/** The project's source rejected its registry entry. */
export class InvalidProjectConfig extends Schema.TaggedError<InvalidProjectConfig>()(
  "InvalidProjectConfig",
  { name: Schema.String, issues: Schema.Array(Schema.String) },
) {
  override get message() {
    return `project ${this.name} has an invalid config: ${this.issues.join("; ")}`
  }
}

/** No loaded source has the kind the project names. */
export class SourceUnavailable extends Schema.TaggedError<SourceUnavailable>()(
  "SourceUnavailable",
  { name: Schema.String, source: Schema.String },
) {
  override get message() {
    return `project ${this.name} uses the ${this.source} source, which is not available here`
  }
}

/** Opening, preparing or removing a project failed in its source. */
export class SourceError extends Schema.TaggedError<SourceError>()("SourceError", {
  name: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Reading or writing `projects.yaml`, or a project's data directory, failed. */
export class RegistryError extends Schema.TaggedError<RegistryError>()("RegistryError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** A sync failed: `offline`, `auth`, `rejected`, `diverged` (a rebase conflicted) or `remote`. */
export class SyncError extends Schema.TaggedError<SyncError>()("SyncError", {
  project: Schema.String,
  reason: Schema.Literals(["offline", "auth", "rejected", "diverged", "remote"]),
  message: Schema.String,
}) {}
