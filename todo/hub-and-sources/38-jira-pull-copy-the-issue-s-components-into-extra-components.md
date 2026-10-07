---
title: "jira pull: copy the issue's components into extra.components"
tags: [jira]
triage: '{"complexity": "simple", "risk": "low", "workDomains": ["backend"], "areas": ["src/jira/pull.ts", "src/jira/client.ts", "src/jira/README.md", "test/jira/pull.test.ts", "test/cli/jira-pull.test.ts"], "uncertainty": ["Whether the pull''s search request already asks for the components field."], "rationale": "One more mapped field in a pure plan, following the pattern title and assignee already use.", "rubricVersion": 1}'
---
**Why.** nzila routes a task on a shared team list to the repository that does it (nzila's docs/specs/m9-team-tasks.md §5 and §8), and the team's Jira says which repository through the issue's **components**. Today `todo jira pull` keeps only `extra.jira_id` from the issue, so the routing field never arrives.

**Decisions.**
- The pull writes the issue's component names to `extra.components`, joined with `, ` in Jira's order. An issue with no components leaves the field absent, and removes it if it was set by an earlier pull.
- Linked tasks follow it on every pull, as they already follow title, description, assignee and status. Like them, the field is overwritten, not merged.
- The search requests the `components` field.
- `--dry-run` shows component changes in the plan.

**Build.** Mapping in `src/jira/pull.ts` (the pure `planPull`), the field in the search request, and `src/jira/README.md`.

**Tests first.** `test/jira/pull.test.ts`: components added, changed, cleared, and an issue with none. A CLI test in `test/cli/jira-pull.test.ts` showing the field in the list.

**Out of scope.** A configurable field map (`fields: { customfield_10042: repo }`), the natural next step.
