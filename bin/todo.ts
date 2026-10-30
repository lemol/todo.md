#!/usr/bin/env bun
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { bundleIsCurrent } from "./freshness.ts"

const root = resolve(import.meta.dir, "..")
const entry = bundleIsCurrent(root) ? "dist/bin.js" : "src/cli/bin.ts"

// Import in this process: argv, stdin, cwd, signals and exit codes pass through.
// Keep import errors outside the freshness check so runtime failures surface.
await import(pathToFileURL(resolve(root, entry)).href)
