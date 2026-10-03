# todo.md

Tasks as plain Markdown, easy for both humans and agents to work with.

todo.md is:

1. **A standard** ([docs/spec.md](docs/spec.md)) for representing tasks and
   the operations on them.
2. **A reference implementation** that stores a list as Markdown files in a
   directory.
3. **A CLI**, `todo`, to manage and view lists.
4. **A private local web app**, built on the same core.

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
| [`@lemol/todo-md/hub`](src/hub)                    | Projects: registry, resolution, a service per project (`hub/testing`: `memorySource`) |
| [`@lemol/todo-md/git`](src/git)                    | `gitSource`: a list in a git repository, cloned locally |
| [`@lemol/todo-md/jira`](src/jira)                  | `jiraSource`: Jira tickets behind a local mirror; complete, reopen, comment and edit title and labels |
| [`@lemol/todo-md/cli`](src/cli)                    | The `todo` command                                     |

Install it from git. Releases are tagged `todo-md@<version>`; `effect` is a
peer dependency.

```sh
bun add "git+ssh://git@github.com/lemol/todo.md.git#todo-md@0.2.0"
```

In [lemol-workspace](https://github.com/lemol/lemol-workspace), it is checked
out at `repos/todo-md` and consumers resolve it through the override
`"@lemol/todo-md": "file:./repos/todo-md"`.

## Docs

- [Specification](docs/spec.md): the model, operations and file format.
- [Architecture](docs/architecture/README.md): how the modules fit together and why.

## Using the CLI

```sh
todo init                              # create ./todo/TODO.md
todo add Fix the login redirect --quick        # jot one down, inline
todo add "Rework auth" --group Backend --description - < notes.md  # its own file
todo                                   # show the open tasks
todo next --json                       # what to work on next, as JSON
todo done 1
todo --help                            # every command has --help
```

Across projects:

```sh
todo projects add ~/labs/acme         # register another list
todo projects add git@github.com:lemol/mionso.git   # or one in a git repository
todo --project acme ls                # work on it from anywhere
todo ls --all                         # everything, every project
todo sync --all                       # refresh remotes
```

Run it with `bun src/cli/bin.ts` from a checkout, `bun link` it, or get
`todo` from `node_modules/.bin` when `@lemol/todo-md` is a dependency. See
the [cli README](src/cli/README.md).

## Using the web app

Run `todo web --dir todo` (`bun src/cli/bin.ts web --dir todo` from source) to open the
local app at `127.0.0.1:4400`. `/` is the dashboard over every registered project;
`/p/<name>` is that project's board. You can add, rename, remove and sync projects
from the browser. Pages and forms work without JavaScript; an optional browser entry
refreshes clean pages when the list changes. The server stays bound to localhost with
a Host allowlist and rejects cross-origin POSTs, which is what makes registry
management from a browser acceptable.

## Development

Requires [Bun](https://bun.sh) 1.4+.

```sh
bun install
bun run check       # lint + typecheck + tests
bun test            # tests only
bun run fix         # apply Biome fixes
```
