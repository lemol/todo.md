# todo.md

Tasks as plain Markdown, easy for both humans and agents to work with.

todo.md is:

1. **A standard** ([docs/spec.md](docs/spec.md)) for representing tasks and
   the operations on them.
2. **A reference implementation** that stores a list as Markdown files in a
   directory.
3. **A CLI**, `todo`, to manage and view lists. A web app will follow, built
   on the same core.

> Status: early. The spec is a 0.1 draft; the modules are scaffolded but not
> implemented yet.

## What a list looks like

```markdown
# Acme API

- [ ] 14 - Write changelog

## Backend

- [ ] [07 - Add rate limiting](./backend/07-add-rate-limiting.md)
- [ ] 03 - Fix login redirect
  #bug @lemol depends_on:1
  Users land on /home instead of the page they requested.
```

- Open tasks live in `TODO.md`, in priority order and grouped by `##`
  headings.
- A task is either one line (plus optional metadata and description) or a
  link to its own file with frontmatter and comments.
- Completed tasks move to `done/`.

## Package

One package, `@lemol/todo-md`, with a subpath per module:

| Import path                                        | Purpose                                                |
| -------------------------------------------------- | ------------------------------------------------------ |
| [`@lemol/todo-md/spec`](src/spec)                  | Model, errors, adapter contract (`spec/testing`: conformance suite) |
| [`@lemol/todo-md/markdown`](src/markdown)          | Parser and minimal-diff writer for the file format     |
| [`@lemol/todo-md/core`](src/core)                  | Adapter-agnostic logic: queries, readiness, validation |
| [`@lemol/todo-md/fs`](src/fs)                      | File-system adapter (the reference implementation)     |
| [`@lemol/todo-md/cli`](src/cli)                    | The `todo` command                                     |

Install it from git. Releases are tagged `todo-md@<version>`; `effect` is a
peer dependency.

```sh
bun add "git+ssh://git@github.com/lemol/todo.md.git#todo-md@0.1.0"
```

In [lemol-workspace](https://github.com/lemol/lemol-workspace), it is checked
out at `repos/todo-md` and consumers resolve it through the override
`"@lemol/todo-md": "file:./repos/todo-md"`.

## Docs

- [Specification](docs/spec.md): the model, operations and file format.
- [Architecture](docs/architecture.md): how the modules fit together and why.

## Development

Requires [Bun](https://bun.sh) 1.4+.

```sh
bun install
bun run check       # lint + typecheck + tests
bun test            # tests only
bun run fix         # apply Biome fixes
```
