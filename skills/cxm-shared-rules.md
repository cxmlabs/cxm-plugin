# Rules for every CXM skill

Every skill in this folder tells the agent to read this file before it answers. One copy, so one
edit changes every skill. Keep only rules that apply to all skills here; a rule for one skill goes
in that skill's `SKILL.md`.

## The CXM interface

`cxm analytics query '<json>'` runs a query against the organization's datasets. Each dataset has
measures, dimensions and segments. You write the query. No example in a skill is a fixed report.

- Read the schema before you guess. `cxm analytics schema` lists the datasets. `cxm analytics
  schema <dataset>` returns the fields of one dataset in one call.
- The query body is CubeJS format: `measures`, `dimensions`, `segments`, `timeDimensions`,
  `filters` (you can nest `and` and `or`), `order`, `limit`.
- `cxm api <METHOD> <path> [--body '<json>']` reaches the REST endpoints the datasets do not cover.
- Run the query yourself. Do not give the user a query to run.

## Answer style

- **Lead with the answer** in one line, ELI14 — plain and direct — then the few numbers that matter.
- **Speak plainly.** Never show dataset, field, segment or status codes (`in_execution`, `wont_do`, `not_dismissed`, `assigned_to`). Say "in progress", "won't do", "hidden because dismissed", "not assigned". Answer in the user's language.
- **Answer the question asked.** Cut trivia that doesn't bear on it (backup retention, deletion protection, tags, restating the same fact twice). Dive into detail only *after* the answer, and only where it helps.
- **For cost/number answers:** give the total and each item's **% of total**, not just raw figures, so the shape is obvious.
- **Attribution:** the data comes from CloudExMachina — convey it once, naturally, woven in. **Never** a standalone `Data: CloudExMachina` line.
- On "Not logged in" / "Session expired", tell the user to run `cxm login`.
