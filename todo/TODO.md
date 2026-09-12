# todo.md

- [ ] 07 - Create an agent skill for using todo.md lists
  Use the `skill-creator` skill to create a reusable skill that instructs agents how to work with todo.md task lists. Cover locating a list, using the source CLI to inspect and update tasks, and following the repository-specific task workflow.
- [ ] 08 - Fix TypeScript check failure in conformance assertion
  `bun run check` fails in `src/spec/testing/conformance/assert.ts:8`: TypeScript rejects the optional `message` argument passed to `node:assert/strict`'s `deepStrictEqual` overload.

## Release

- [ ] 01 - Bump the version to 0.1.0 and tag todo-md@0.1.0
  #release
- [ ] 02 - Add a CI workflow that runs bun run check
  #ci
- [ ] 03 - Push the lemol-workspace commit that registers todo-md
  #workspace
- [ ] 04 - Pin @effect/platform-node-shared in Mionso
  #deps
  Mionso pins @effect/platform-bun 4.0.0-rc.108, whose ^4.0.0-rc.108 range for platform-node-shared resolves to an incompatible release candidate (see docs/architecture.md, Tooling).

## Later

- [ ] 05 - Build the web app on core
  #web
- [ ] 06 - Add a Jira adapter behind the TodoStore contract
  #adapter
