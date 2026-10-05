# Refuse Comment Bodies Containing Unescaped Headings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refuse comment bodies containing unescaped level-1 to level-3 headings (ATX or setext) outside code fences with a `ValidationError` when calling `todo.comment`.

**Architecture:** Pure markdown heading detection `hasUnescapedHeading` lives in `src/markdown/taskFile.ts` using `parseAst` to check for top-level heading nodes (depth <= 3). `FsTodoStore.comment` imports and enforces it before acquiring write locks or modifying disk, rejecting with `ValidationError`.

**Tech Stack:** Bun, Effect 4, `mdast-util-from-markdown` via `src/markdown/ast.ts`, `bun:test`.

**Spec:** [`docs/spec.md`](../../spec.md) §2.6 and §2.10.

Task Shape: cross-module format validation spanning markdown parser, fs store, and cli interface

## Global Constraints

- `docs/spec.md` is the source of truth for behavior (§2.6: comment bodies MUST NOT contain level-1 to level-3 headings).
- Module boundaries: `spec` has `modules: []`, `markdown` has `modules: ["spec"]`, `fs` has `modules: ["spec", "markdown"]`. Heading validation stays in `markdown` and `fs`; `spec` is untouched.
- Minimal diffs: Splice text, never re-serialize whole Markdown files (spec §2.10).
- Blank lines carry structure: Blank lines around `if`, separate consts, braces for multiline blocks.
- Static checks: Implementer runs `bun x oxlint`, `bun x tsc --noEmit`, and focused test files separately.

## Load-Bearing Claims

1. `parseTaskFile` inspects only top-level AST children (`tree.children`) for headings:
   Run: `rg -n "tree\.children" src/markdown/taskFile.ts`
   Observed:
   ```
   79:  const lastSection = tree.children
   175:    const headings = tree.children.filter(
   ```
2. Boundary rules forbid `spec` importing `markdown`, but permit `fs` importing `markdown`:
   Run: `rg -n "(spec|fs): \{" test/boundaries.test.ts`
   Observed:
   ```
   10:  spec: { modules: [], packages: ["effect"] },
   25:  fs: { modules: ["spec", "markdown"], packages: ["effect"] },
   ```
3. Adding comments can only occur via `store.comment(id, input)`: `TaskInput` and `TaskPatch` schemas in `src/spec/model.ts` do not contain a `comments` field, so `add` and `update` cannot receive or create comments.

---

### Task 1: Markdown Heading Detection & Spec Update

**Files:**
- Modify: `docs/spec.md:587-592`
- Modify: `src/markdown/taskFile.ts:344-364`
- Test: `test/markdown/taskFile.test.ts`

**Interfaces:**
- Produces: `hasUnescapedHeading(body: string): boolean` in `src/markdown/taskFile.ts` (re-exported by `src/markdown/index.ts`).

- [ ] **Step 1: Write failing unit tests in `test/markdown/taskFile.test.ts`**

Add tests to `test/markdown/taskFile.test.ts` (probed):

```ts
describe("hasUnescapedHeading", () => {
  test("detects unescaped ATX and setext headings", () => {
    expect(hasUnescapedHeading("## Heading 2")).toBe(true)
    expect(hasUnescapedHeading("### Heading 3")).toBe(true)
    expect(hasUnescapedHeading("# Heading 1")).toBe(true)
    expect(hasUnescapedHeading("Heading\n---")).toBe(true)
    expect(hasUnescapedHeading("Heading\n===")).toBe(true)
  })

  test("allows depth 4 or deeper, code fences, inline code, and escapes", () => {
    expect(hasUnescapedHeading("#### Heading 4")).toBe(false)
    expect(hasUnescapedHeading("```\n## Code\n### Code\n```")).toBe(false)
    expect(hasUnescapedHeading("~~~\n## Code\n~~~")).toBe(false)
    expect(hasUnescapedHeading("Use `## Code` here")).toBe(false)
    expect(hasUnescapedHeading("\\## Not a heading")).toBe(false)
    expect(hasUnescapedHeading("Text\n\n---\n\nMore text")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/markdown/taskFile.test.ts`
Expected: FAIL with `hasUnescapedHeading is not defined` (or imported).

- [ ] **Step 3: Implement `hasUnescapedHeading` and update spec §2.10**

In `src/markdown/taskFile.ts`, export the function (probed):
```ts
export const hasUnescapedHeading = (body: string): boolean =>
  parseAst(body).children.some((node) => node.type === "heading" && node.depth <= 3)
```

In `docs/spec.md` §2.10 under `- **comment:**`, prepend step:
`1. Refuse comment bodies containing unescaped level-1 to level-3 headings with ValidationError (§2.6).`

- [ ] **Step 4: Run tests and verify PASS**

Run: `bun test test/markdown/taskFile.test.ts`
Base output before task: 28 pass, 0 fail.
Expected after task: 30 pass, 0 fail.

---

### Task 2: Enforce in `FsTodoStore.comment` and Verify CLI

**Files:**
- Modify: `src/fs/FsTodoStore.ts:487-501`
- Test: `test/fs/writing.test.ts`
- Test: `test/cli/tasks.test.ts`

**Interfaces:**
- Consumes: `hasUnescapedHeading` from `../markdown/index.ts`
- Produces: `FsTodoStore.comment` returns `Effect.fail(new ValidationError({ issues: ["comment body must not contain unescaped headings"] }))` when `hasUnescapedHeading(valid.body)` is true.

- [ ] **Step 1: Write failing tests in `test/fs/writing.test.ts` and `test/cli/tasks.test.ts`**

In `test/fs/writing.test.ts`, add the store test (probed):

```ts
  effectTest(
    "comment refuses comment body with unescaped depth-2 or depth-3 headings",
    Effect.gen(function* () {
      const store = yield* TodoStore
      yield* failsWith(store.comment("1", { author: "lemol", body: "## ATX 2" }), "ValidationError")
      yield* failsWith(store.comment("1", { author: "lemol", body: "### ATX 3" }), "ValidationError")
      yield* failsWith(store.comment("1", { author: "lemol", body: "Setext\n---" }), "ValidationError")
      const valid = yield* store.comment("1", { author: "lemol", body: "#### Allowed 4\n```\n## In fence\n```" })
      expect(valid.body).toBe("#### Allowed 4\n```\n## In fence\n```")
    }),
    list(),
  )
```

In `test/cli/tasks.test.ts`, add the CLI test under `describe("todo comment", ...)` (probed):

```ts
  effectTest(
    "refuses comment body with unescaped depth-2 heading",
    Effect.gen(function* () {
      const result = yield* todo("comment", "1", "##", "Broken", "Heading")
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("comment body must not contain unescaped headings")
    }),
    diskWith(acme),
  )
```

- [ ] **Step 2: Run tests to verify failure on base commit**

Run: `bun test -t "refuses comment body with unescaped" test/fs/writing.test.ts test/cli/tasks.test.ts`
Known-bad base commit behavior:
- On base commit, `store.comment("1", { author: "lemol", body: "## ATX 2" })` succeeds and corrupts file layout so `store.get("1")` returns 0 comments.
- On base commit, `todo("comment", "1", "##", "Broken", "Heading")` exits with code 0 (`{ code: 0, stdout: "Commented on 01", stderr: "" }`).
Observed probe:
```
BASE COMMIT COMMENT SUCCEEDED: ## Broken Heading
RELOADED COMMENTS COUNT: 0
```

- [ ] **Step 3: Enforce heading validation in `FsTodoStore.comment`**

In `src/fs/FsTodoStore.ts`:
1. Import `hasUnescapedHeading` from `../markdown/index.ts`.
2. In `comment: (id, input)`:
```ts
comment: (id, input) =>
  Effect.gen(function* () {
    const valid = yield* validate(CommentInput, input)

    if (hasUnescapedHeading(valid.body)) {
      return yield* new ValidationError({
        issues: ["comment body must not contain unescaped headings"],
      })
    }

    return yield* mutate((snapshot) =>
      Effect.gen(function* () {
```

- [ ] **Step 4: Run focused tests and verify PASS**

Run: `bun test test/fs/writing.test.ts test/cli/tasks.test.ts test/boundaries.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Run static checks**

Run separate commands:
1. `bun x oxlint`
2. `bun x tsc --noEmit`
Verify search for changed values: `rg "hasUnescapedHeading" src/ test/` to confirm all call sites and exports match.
