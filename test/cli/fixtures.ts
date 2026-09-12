import { md } from "../fs/helpers.ts"

/** A list with ungrouped and grouped tasks, a linked task file, a dependency and a done task. */
export const acme = {
  "TODO.md": md(
    "# Acme API",
    "",
    "- [ ] 01 - Write changelog",
    "",
    "## Backend",
    "",
    "- [ ] [02 - Add rate limiting](./backend/02-add-rate-limiting.md)",
    "- [ ] 03 - Fix login redirect",
    "  #bug @lemol depends_on:2",
    "  Users land on /home.",
    "",
    "## Frontend",
    "",
    "- [ ] 04 - Fix layout",
    "  @claude",
  ),
  "backend/02-add-rate-limiting.md": md(
    "---",
    "title: Add rate limiting",
    "tags: [api]",
    "---",
    "Token bucket per API key.",
    "",
    "## Comments",
    "",
    "### @lemol at 2026-09-12 12:00",
    "",
    "Started.",
  ),
  "done/05-set-up-ci.md": md(
    "---",
    "title: Set up CI",
    "completed_at: 2026-09-10T08:00:00Z",
    "---",
  ),
}

export const lines = (...text: string[]) => text.join("\n")
