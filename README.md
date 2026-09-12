# todo.md

Tasks as plain Markdown, easy for both humans and agents to work with.

todo.md is:

1. **A standard** ([docs/spec.md](docs/spec.md)) for representing tasks and
   the operations on them.
2. **A reference implementation** that stores a list as Markdown files in a
   directory.
3. **A CLI**, `todo`, to manage and view lists. A web app will follow, built
   on the same core.

> Status: early. The spec is a 0.1 draft; the packages are scaffolded but not
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

## Packages

| Package                                   | Purpose                                             |
| ----------------------------------------- | --------------------------------------------------- |
| [`@lemol/todo-md-spec`](packages/spec)         | Model, errors, adapter contract, conformance suite  |
| [`@lemol/todo-md-markdown`](packages/markdown) | Parser and minimal-diff writer for the file format  |
| [`@lemol/todo-md-core`](packages/core)         | Adapter-agnostic logic: queries, readiness, validation |
| [`@lemol/todo-md-fs`](packages/fs)             | File-system adapter (the reference implementation)  |
| [`@lemol/todo-md-cli`](packages/cli)           | The `todo` command                                  |

## Docs

- [Specification](docs/spec.md): the model, operations and file format.
- [Architecture](docs/architecture.md): how the packages fit together and why.

## Development

Requires [Bun](https://bun.sh) 1.4+.

```sh
bun install
bun test            # run tests
bun run typecheck   # type-check all packages
bun run lint        # Biome lint + format check
```
