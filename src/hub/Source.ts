import type { DateTime, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect"
import type { TodoStore } from "../spec/index.ts"
import type { SourceError, SyncError } from "./errors.ts"

/** The services the hub provides to every source call, on top of what the source was built with. */
export type SourceEnv = FileSystem.FileSystem | Path.Path

/** The project a source is asked to act on. */
export interface SourceProject<C> {
  readonly name: string
  readonly config: C
  /** The project's data directory, `<home>/projects/<name>`; `undefined` for unregistered projects. */
  readonly dir: string | undefined
}

/** What a successful sync reports. */
export interface SyncOutcome {
  /** One line for people, e.g. "pulled 3 commits, pushed 1". */
  readonly summary: string
  readonly ahead?: number
  readonly behind?: number
}

/** A project's status: its last sync (`state.json`) overlaid with the source's live fields; `error` for a broken entry. */
export interface ProjectStatus {
  readonly lastSync?: DateTime.Utc
  readonly result: "ok" | "error" | "never"
  /** The last sync error, or why the project's entry is unusable. */
  readonly error?: string
  /** git: local commits not pushed. */
  readonly ahead?: number
  /** git: remote commits not pulled, as of the last fetch. */
  readonly behind?: number
  /** git: the last rebase conflicted. */
  readonly diverged?: boolean
}

/** A project as frontends see it. */
export interface ProjectInfo {
  readonly name: string
  /** The source kind, e.g. `fs`. */
  readonly source: string
  /** A path, URL or site, for display; empty when the entry is unusable. */
  readonly location: string
  readonly registered: boolean
  /** Whether the source can sync. */
  readonly syncable: boolean
  readonly status: ProjectStatus
}

/**
 * A kind of project: turns a registry entry into a `TodoStore`. Sources are
 * plain values passed to `Hub.layer`; any services beyond `SourceEnv` must
 * already be provided when the value is built.
 */
export interface Source<C> {
  /** The `source` value in the registry, e.g. `fs`. Unique among a hub's sources. */
  readonly kind: string
  /** Decodes and validates the entry's fields (everything but `source`), after `~` expansion. */
  readonly config: Schema.Codec<C, unknown>
  /** The name `add` uses when none is given. */
  defaultName?(config: C): string | undefined
  /** A path, URL or site, for display. */
  location(config: C): string
  /** Runs on `add`, after the data directory exists and before the entry is written. */
  prepare?(project: SourceProject<C>): Effect.Effect<void, SourceError, SourceEnv>
  /** The project's store. */
  open(project: SourceProject<C>): Layer.Layer<TodoStore, SourceError, SourceEnv>
  /** Refreshes the local replica. The hub serializes syncs per project and records the outcome. */
  sync?(project: SourceProject<C>): Effect.Effect<SyncOutcome, SyncError, SourceEnv>
  /** Emits when the local replica changes. Runs only while `hub.changes` has subscribers; ends the stream (never fails) when it cannot watch. */
  changes?(project: SourceProject<C>): Stream.Stream<void, never, SourceEnv>
  /** Live status fields, such as git's `ahead`; they override `state.json`'s. A defect here is logged and ignored. */
  status?(project: SourceProject<C>): Effect.Effect<Partial<ProjectStatus>, never, SourceEnv>
  /** Runs on `remove`, before anything is deleted; fails to refuse. */
  beforeRemove?(
    project: SourceProject<C>,
    force: boolean,
  ): Effect.Effect<void, SourceError, SourceEnv>
  /** Whether this project's list is the one at `listRoot`, for resolution from a working directory. */
  owns?(config: C, listRoot: string): Effect.Effect<boolean, never, SourceEnv>
}

/** A source of any config type, as `Hub.layer` takes them. */
export type AnySource = Source<unknown>
