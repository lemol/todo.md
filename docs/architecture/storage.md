# Storage: `markdown` and `fs`

The file-system format (spec Part 2) is implemented by two modules: a pure
`markdown` library and the `fs` adapter that does the I/O.

## markdown

`markdown` is a pure library: strings in, model and strings out.

- **Parsing uses `mdast-util-from-markdown`** with the GFM task-list and
  frontmatter extensions. The AST gives headings, lists, links and code
  fences, following CommonMark. Every node carries source offsets.
- **The parse result records where everything is.** Each section and item
  keeps its line range, so edits know exactly which lines to replace.
  Titles, metadata and descriptions are read from the source lines, not
  re-rendered from the AST.
- **Writing splices lines; it never re-serializes.** Edits such as
  `insertItem`, `removeItem`, `replaceItem`, `setItemHead`, `updateTaskFile`
  and `prependComment` replace only the lines involved, and new lines come
  from small canonical templates. This is how the spec's minimal-diff rule
  (§2.10) holds. `remark-stringify` is deliberately not used, because it
  rewrites the whole document.
- **Frontmatter edits rewrite only the changed keys' lines**, using the
  source ranges `yaml` reports, so comments and formatting elsewhere survive.
- **It also owns:**
  - the text-only steps of normalization (assigning IDs, syncing link text);
    the `fs` adapter does the steps that move files;
  - slugs, paths and ID formatting;
  - the metadata-line grammar;
  - converting between the format and the model;
  - the diagnostics that need only the text.
- **It doesn't depend on Bun or Node**, so a browser or another file-based
  adapter can reuse it.
- **Tests compare exact text:** each edit's test states the whole expected
  output, so it also proves nothing else changed.

## fs

`FsTodoStore.layer({ root })` implements `TodoStore` for a list directory
using Effect's `FileSystem` and `Path` services, and passes the same
conformance suite as `MemoryTodoStore`. `findListRoot(cwd)` handles
discovery: starting at `cwd` and walking up, the first directory where
`todo/TODO.md` or `TODO.md` exists wins, with `todo/TODO.md` preferred at
each level. `initList(dir, options)` creates a list.

### The write path

Every mutating operation runs the same pipeline:

```
acquire lock
  → normalize (spec §2.11)
  → read a snapshot: TODO.md, linked task files, done files
  → apply the operation's edits (markdown)
  → write files in crash-safe order
release lock
```

Reads (`load`, `get`, `listDone`, `diagnostics`) take the snapshot without
the lock and never write.

- **No cache of the list.** Every operation re-reads the files, so hand edits
  made between commands are always seen. A long-running host (the web app)
  watches files instead of caching them.
- **Parses are cached by content.** Reading is cheap; parsing Markdown into a
  syntax tree is nearly all the cost of a snapshot (about 3 ms a task file),
  and between two reads almost every file is unchanged. So a store remembers
  each task file's parse by path and text (`fs/parsing.ts`), in memory and,
  given `cacheDir`, in a file there between processes. The hub passes
  `<home>/cache`, so the file stays outside the list. Only an identical text
  reuses a parse, so the cache cannot go stale and needs no watcher; a
  missing or unreadable cache file only costs a full parse. Bump
  `taskFileParserVersion` when `parseTaskFile`'s output changes.
- **Atomic writes.** Each file is written to a temporary file in the same
  directory, then renamed over the original.
- **Advisory lock.** `<root>/.todo.lock` is created exclusively for the
  duration of a mutation, so parallel processes, typically several agents,
  cannot lose each other's updates. A lock older than a timeout is treated as
  stale and taken over. Reads don't lock.
- **Crash-safe ordering.** Multi-file operations order their steps so that an
  interruption leaves a state that normalization can repair or a diagnostic
  reports. For `complete` and `reopen` the done file is the commit point
  (spec §2.10): an interrupted completion is finished, and an interrupted
  reopen is rolled back.
- **Normalization** is also exposed on its own as
  `FsTodoStore.normalize(root)`. It is specific to the file format, so it is
  not part of the contract; the CLI's `fmt` command calls it directly.
- **Bounded scanning.** Orphan task files are looked for only directly in the
  tasks directory and its group directories, so a list at a project root
  never walks the whole project.
