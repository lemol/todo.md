---
title: A hub registry syntax error ends at a colon
tags: [bug, hub]
---
Found by the controller's post-land review of todo-md:68 (landed `95e9c79`). 69 fixes the same flaw for task-file frontmatter and leaves the registry out of scope, naming 68. 68 only covered alias messages.

Evidence (scratch at `95e9c79`, own `HOME` and `TODO_MD_HOME`):

- `projects.yaml` = `projects: !!map *x\n`. `todo projects ls` exits 1 with `error: <file>: An alias node must not specify any properties at line 1, column 17:`.
- `yamlFailure` in `src/hub/registry.ts` keeps the first line of `yaml`'s message. That message continues after the colon with a code frame, so every YAML syntax error in the registry prints a dangling colon. Every `todo` command that reads the hub prints this message.

#### What to build

1. A registry YAML syntax error's message does not end at a dangling colon. Keep the position (the registry has no fence, so `yaml`'s line is the file's line). Reuse 69's approach if it has landed, so the two messages read alike.
2. Messages without a position (an unresolved alias, an alias bomb, "projects must be a map") stay as they are.

#### Tests first

- `test/hub/registry.test.ts`: `projects: [\n` and `projects: !!map *x\n` make `entries` fail with a `RegistryError` whose exact message has no trailing colon and names line and column.
- `test/cli/bin.test.ts`'s bad-registry case, if it asserts a syntax error, gets the new message.

#### Done when

No registry error message ends at a colon.

#### Out of scope

Frontmatter (69). The layout of edited entries (70).
