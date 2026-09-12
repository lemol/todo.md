import { findItem, type TodoFile, type TodoItem } from "../../src/markdown/todoFile.ts"

export const md = (...lines: string[]) => `${lines.join("\n")}\n`

export const example = md(
  "---",
  "done_dir: archive",
  "---",
  "# Acme API",
  "",
  "Backlog for the Acme API.",
  "",
  "- [ ] 14 - Write changelog",
  "",
  "## Backend",
  "",
  "Server-side work.",
  "",
  "- [ ] [07 - Add rate limiting](./backend/07-add-rate-limiting.md)",
  "- [ ] 03 - Fix login redirect",
  "  #bug @lemol depends_on:1",
  "  Users land on /home instead of the page they requested.",
  "",
  "  - check the referrer",
  "",
  "A note between tasks.",
  "",
  "* [X] 09 - Bump deps",
  "",
  "## Frontend ##",
)

export const itemOf = (todo: TodoFile, id: string): TodoItem => {
  const found = findItem(todo, id)
  if (found === undefined) throw new Error(`no item ${id}`)
  return found
}
