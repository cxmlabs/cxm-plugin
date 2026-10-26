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

## Visuals

Draw a picture when it shows the shape faster than text: a breakdown (bar), a trend (line, or
`column` for a few periods), a change up and down (bar with `"diverging": true`), an architecture
(mermaid `flowchart`). One picture per answer at most. Keep the one-line answer above it.

- A chart block is single-line JSON: `{"type":"bar|line|column|pie","title":"…","x":"<key>","y":"<key>","yName":"…","series":"<key>","yFormat":"currency|number|percent","xFormat":"month|date","table":true,"data":[{…}]}`.
  `x`, `y` and `series` name keys of the `data` rows. `title` and `yName` are plain words, never a dataset field. `"table": true` puts the values beside the chart; then do not repeat them in a markdown table.
- For a chart from a query, put the query in place of `data` and use the `cube-chart` kind: `{"type":"line","title":"…","x":"<dataset>.<time>.month","xFormat":"month","y":"<dataset>.<measure>","yName":"…","query":{…}}`.
- A diagram is a mermaid `flowchart LR` with `subgraph` groups and `-->|label|` edges. Name the service in each node label (`RDS`, `ECS`, `Key Vault`): the label sets the node's color, unless a `classDef` sets it.
- **When your instructions say "CXM rich visuals are on"**, write the block in the reply as a fenced block of its kind (` ```chart `, ` ```cube-chart `, ` ```mermaid `). It is drawn in place.
- **Otherwise**, pass the block on stdin through a quoted heredoc, `cxm viz <chart|cube-chart|mermaid> - <<'EOF'` … `EOF`, never inline (a quote in a label breaks the shell), and paste its output unchanged into the reply in a plain ` ``` ` block. Never paste the JSON or the mermaid source.
